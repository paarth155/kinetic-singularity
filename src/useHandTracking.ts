import { useEffect, useRef, useState } from 'react';
import { HandLandmarker, FilesetResolver, DrawingUtils } from '@mediapipe/tasks-vision';

export type Landmark = { x: number; y: number; z: number; visibility?: number };

export type Gesture = 'IndexPoint' | 'Pinch' | 'Fist' | 'Peace' | 'OpenPalm' | 'None';

export type HandState = {
  landmarks: Landmark[];
  handedness: 'Left' | 'Right';
  gesture: Gesture;
  pinchRatio: number; // expose raw ratio for App.tsx to use for scaling
};

// MediaPipe landmark indices for reference
// 0=wrist 1-4=thumb 5-8=index 9-12=middle 13-16=ring 17-20=pinky
// MCP=knuckle, PIP=first joint, DIP=second joint, TIP=tip

export function useHandTracking(
  videoRef: React.RefObject<HTMLVideoElement | null>,
  canvasRef: React.RefObject<HTMLCanvasElement | null>
) {
  const [isReady, setIsReady] = useState(false);

  // ── Hot refs: updated synchronously inside MediaPipe loop, never go through React ──
  const handsRef = useRef<HandState[]>([]);

  // ── Display refs: throttled snapshots of hot refs for the JSX overlay ──
  // Updated at ~8fps so React re-renders at most 8×/sec instead of 30×/sec.
  const [handsDisplay, setHandsDisplay] = useState<HandState[]>([]);
  const [latency, setLatency] = useState(0);
  const lastHandsDisplayUpdateRef = useRef(0);
  const lastLatencyUpdateRef = useRef(0);
  // EMA-smoothed latency accumulator (updated every detection frame, displayed slowly)
  const emaLatencyRef = useRef(0);
  const HANDS_DISPLAY_INTERVAL_MS = 120; // ~8fps
  const LATENCY_DISPLAY_INTERVAL_MS = 500; // 2fps — number is decorative

  const landmarkerRef = useRef<HandLandmarker | null>(null);
  const drawingUtilsRef = useRef<DrawingUtils | null>(null);
  const requestRef = useRef<number>(0);

  // ─── Model Init ───────────────────────────────────────────────────────────
  useEffect(() => {
    let active = true;

    async function init() {
      const vision = await FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm'
      );
      const landmarker = await HandLandmarker.createFromOptions(vision, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task',
          delegate: 'GPU',
        },
        runningMode: 'VIDEO',
        numHands: 2,
        // Balanced confidence: low enough to detect reliably, high enough to reject ghosts
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.6,
      });
      if (active) {
        landmarkerRef.current = landmarker;
        setIsReady(true);
      }
    }
    init();

    return () => {
      active = false;
      if (landmarkerRef.current) landmarkerRef.current.close();
    };
  }, []);

  // ─── Tracking Loop ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!isReady || !videoRef.current || !canvasRef.current) return;

    const video = videoRef.current;
    let lastVideoTime = -1;

    // Per-hand smoothed landmark history for the EMA filter
    const smoothed: Record<string, Landmark[]> = {};

    // Pinch hysteresis: two thresholds so pinch doesn't flicker on/off
    const pinchActive: Record<string, boolean> = { Right: false, Left: false };
    const PINCH_ENTER = 0.17; // tight to enter (ratio to palm size)
    const PINCH_EXIT  = 0.30; // wide to exit

    // Gesture debounce: each gesture class has its own required hold-frame count
    // Faster gestures (Pinch) confirm quicker; destructive ones (Fist) need longer holds
    const GESTURE_FRAMES: Record<Gesture, number> = {
      IndexPoint: 3,
      Pinch:      3,
      Peace:      4,
      OpenPalm:   4,
      Fist:       8,  // Fist = clear canvas, needs extra guard frames
      None:       2,
    };

    interface GestureHistory {
      raw: Gesture;
      stable: Gesture;
      count: number;
    }
    const gestureHistory: Record<string, GestureHistory> = {
      Right: { raw: 'None', stable: 'None', count: 0 },
      Left:  { raw: 'None', stable: 'None', count: 0 },
    };

    // Per-slot handedness history: MediaPipe assigns hands to slot 0 and 1.
    // We track the last N confirmed handedness labels per slot so a 1-frame
    // misclassification doesn't flip which hand is "Right" mid-drawing.
    const HANDEDNESS_LOCK_FRAMES = 5;
    const slotHandedness: Record<number, { label: string; count: number; locked: string }> = {
      0: { label: '', count: 0, locked: '' },
      1: { label: '', count: 0, locked: '' },
    };

    function getStableHandedness(slotIndex: number, rawLabel: string): string {
      const slot = slotHandedness[slotIndex];
      if (!slot) return rawLabel;
      if (slot.label === rawLabel) {
        slot.count = Math.min(slot.count + 1, 60);
      } else {
        slot.label = rawLabel;
        slot.count = 1;
      }
      // Only commit the new label once it has been consistent for N frames
      if (slot.count >= HANDEDNESS_LOCK_FRAMES) {
        slot.locked = rawLabel;
      }
      // If we've never locked a value yet, use the raw label on the first frames
      return slot.locked || rawLabel;
    }

    // Start webcam at maximum available resolution
    const streamRef = { current: null as MediaStream | null };
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } } })
      .then((stream) => {
        streamRef.current = stream;
        video.srcObject = stream;
        video.addEventListener('loadeddata', predictWebcam);
      });

    // ── Helpers ─────────────────────────────────────────────────────────────

    /** 3D normalised Euclidean distance between two landmarks */
    function dist(a: Landmark, b: Landmark) {
      return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
    }

    /**
     * True finger extension check.
     * A finger is "extended" when:
     *   - The TIP is further from the WRIST than the PIP joint  (length check)
     *   - AND the TIP is further from the MCP (base knuckle) than the PIP is  (curl check)
     * Using both conditions together handles downward/sideways pointing reliably.
     */
    function isFingerExtended(tip: Landmark, _dip: Landmark, pip: Landmark, mcp: Landmark, wrist: Landmark): boolean {
      const tipToWrist = dist(tip, wrist);
      const pipToWrist = dist(pip, wrist);
      const tipToMcp   = dist(tip, mcp);
      const pipToMcp   = dist(pip, mcp);

      // Finger is extended if tip is further than PIP from BOTH the wrist and its own knuckle
      return tipToWrist > pipToWrist && tipToMcp > pipToMcp * 0.9;
    }

    /**
     * Full gesture classification.
     * Receives smoothed landmarks and the current pinch state for this hand.
     */
    function detectGesture(lm: Landmark[], handedness: string): { gesture: Gesture; pinchRatio: number } {
      const wrist = lm[0];

      // Finger extension using the stronger 2-condition check
      const indexExt  = isFingerExtended(lm[8],  lm[7],  lm[6],  lm[5],  wrist);
      const middleExt = isFingerExtended(lm[12], lm[11], lm[10], lm[9],  wrist);
      const ringExt   = isFingerExtended(lm[16], lm[15], lm[14], lm[13], wrist);
      const pinkyExt  = isFingerExtended(lm[20], lm[19], lm[18], lm[17], wrist);

      // Palm scale = wrist ↔ middle MCP knuckle (scale-invariant reference)
      const palmScale = dist(wrist, lm[9]);

      // Pinch ratio: thumb tip ↔ index tip, normalised by palm size
      const rawPinchDist  = dist(lm[4], lm[8]);
      const pinchRatio    = palmScale > 0 ? rawPinchDist / palmScale : 1;

      // Hysteresis pinch state
      const wasPinching   = pinchActive[handedness];
      const isPinch       = wasPinching ? pinchRatio < PINCH_EXIT : pinchRatio < PINCH_ENTER;
      pinchActive[handedness] = isPinch;

      const isFist    = !indexExt && !middleExt && !ringExt && !pinkyExt;
      const isOpen    = indexExt && middleExt && ringExt && pinkyExt;
      const isPeace   = indexExt && middleExt && !ringExt && !pinkyExt;
      const isPoint   = indexExt && !middleExt && !ringExt && !pinkyExt;

      let gesture: Gesture = 'None';

      if (handedness === 'Right') {
        // Priority order: Pinch > Fist > IndexPoint > None
        // Pinch checked BEFORE Fist because a tight pinch curls fingers, triggering isFist too
        if (isPinch)  gesture = 'Pinch';
        else if (isFist)   gesture = 'Fist';
        else if (isPoint)  gesture = 'IndexPoint';
      } else {
        // Left hand: Pinch > OpenPalm > Peace > None
        if (isPinch)  gesture = 'Pinch';
        else if (isOpen)   gesture = 'OpenPalm';
        else if (isPeace)  gesture = 'Peace';
      }

      return { gesture, pinchRatio };
    }

    // ── Debounce ─────────────────────────────────────────────────────────────

    function stabiliseGesture(raw: Gesture, history: GestureHistory): Gesture {
      if (history.raw === raw) {
        history.count = Math.min(history.count + 1, 60);
      } else {
        history.raw   = raw;
        history.count = 1;
      }
      // Lock in once gesture has been stable for the required number of frames
      if (history.count >= GESTURE_FRAMES[raw]) {
        history.stable = raw;
      }
      return history.stable;
    }

    // ── EMA Smoother ────────────────────────────────────────────────────────

    /**
     * Velocity-adaptive EMA: fast motion → high alpha (responsive), still → low alpha (stable).
     * Uses only the XY delta for velocity (Z is inherently noisier and less important for 2D drawing).
     */
    function smoothLandmarks(raw: Landmark[], prevSmoothed: Landmark[]): Landmark[] {
      return raw.map((lm, i) => {
        const prev = prevSmoothed[i];
        if (!prev) return lm;

        const dx    = lm.x - prev.x;
        const dy    = lm.y - prev.y;
        const speed = Math.hypot(dx, dy); // normalised [0..~0.1]

        // Remap speed to alpha: still→0.18 (heavy smoothing), fast→0.80 (very responsive)
        const alpha = Math.min(0.80, Math.max(0.18, speed * 18.0));

        return {
          x: prev.x + alpha * dx,
          y: prev.y + alpha * dy,
          z: prev.z + alpha * (lm.z - prev.z),
          visibility: lm.visibility,
        };
      });
    }

    // ── HUD Drawing ──────────────────────────────────────────────────────────

    const GESTURE_COLORS: Record<Gesture, string> = {
      IndexPoint: '#00ff88',
      Pinch:      '#ff51fa',
      Fist:       '#ff4444',
      Peace:      '#8ff5ff',
      OpenPalm:   '#ffd000',
      None:       '#ffffff44',
    };

    function drawHUD(smoothedByHand: Record<string, Landmark[]>, gestureByHand: Record<string, Gesture>) {
      const hudCanvas = canvasRef.current;
      if (!hudCanvas) return;
      const ctx = hudCanvas.getContext('2d');
      if (!ctx) return;

      // Match canvas resolution to video
      if (hudCanvas.width !== video.videoWidth || hudCanvas.height !== video.videoHeight) {
        hudCanvas.width  = video.videoWidth;
        hudCanvas.height = video.videoHeight;
      }
      ctx.clearRect(0, 0, hudCanvas.width, hudCanvas.height);

      if (!drawingUtilsRef.current) {
        drawingUtilsRef.current = new DrawingUtils(ctx);
      }
      const du = drawingUtilsRef.current;

      for (const [hand, lm] of Object.entries(smoothedByHand)) {
        const gesture     = gestureByHand[hand] ?? 'None';
        const accentColor = GESTURE_COLORS[gesture];

        // Skeleton connectors (subtle cyan)
        du.drawConnectors(lm as any, HandLandmarker.HAND_CONNECTIONS, {
          color: 'rgba(143,245,255,0.35)',
          lineWidth: 1.5,
        });

        // All joints (dim)
        du.drawLandmarks(lm as any, { color: 'rgba(255,255,255,0.25)', lineWidth: 1, radius: 1.5 });

        // Fingertips — highlight with gesture accent colour so user can see what's active
        const TIPS = [4, 8, 12, 16, 20];
        for (const tip of TIPS) {
          const pt = lm[tip];
          if (!pt) continue;
          const cx = pt.x * hudCanvas.width;
          const cy = pt.y * hudCanvas.height;
          ctx.beginPath();
          ctx.arc(cx, cy, tip === 8 ? 7 : 4, 0, Math.PI * 2);
          ctx.fillStyle   = accentColor;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur  = 12;
          ctx.fill();
          ctx.shadowBlur = 0;
        }

        // Gesture label above wrist
        const wrist = lm[0];
        if (wrist) {
          const wx = wrist.x * hudCanvas.width;
          const wy = wrist.y * hudCanvas.height;
          ctx.font      = 'bold 13px monospace';
          ctx.fillStyle = accentColor;
          ctx.shadowColor = accentColor;
          ctx.shadowBlur  = 8;
          ctx.fillText(`${hand}: ${gesture}`, wx - 30, wy + 20);
          ctx.shadowBlur = 0;
        }
      }
    }

    // ── Main Prediction Loop ─────────────────────────────────────────────────

    function predictWebcam() {
      try {
        if (video.currentTime !== lastVideoTime && landmarkerRef.current) {
          const t0 = performance.now();
          lastVideoTime = video.currentTime;
          const results = landmarkerRef.current.detectForVideo(video, t0);

          // Track which hands appeared this frame so we can clear stale ones
          const activeHands = new Set<string>();

          if (results?.landmarks?.length) {
            const smoothedByHand: Record<string, Landmark[]>  = {};
            const gestureByHand:  Record<string, Gesture>     = {};

            const newHands: HandState[] = results.landmarks.map((rawLm, i) => {
              // Defensive access: MediaPipe sometimes drops handedness data even when landmarks are found
              const rawLabel = results.handednesses?.[i]?.[0]?.categoryName || 'Right';
              // Persist handedness per slot to survive 1-2 frame misclassifications
              const stableLabel = getStableHandedness(i, rawLabel);
              // Mirror: MediaPipe 'Right' in the flipped webcam image = user's Left hand
              const hand   = stableLabel === 'Right' ? 'Left' : 'Right';
              activeHands.add(hand);

              // Apply velocity-adaptive EMA smoothing
              const prev    = smoothed[hand] ?? rawLm;
              const lm      = smoothLandmarks(rawLm, prev);
              smoothed[hand] = lm;

              // Detect + debounce gesture
              const { gesture: rawGesture, pinchRatio } = detectGesture(lm, hand);
              const stableGesture = stabiliseGesture(rawGesture, gestureHistory[hand]);

              smoothedByHand[hand] = lm;
              gestureByHand[hand]  = stableGesture;

              return {
                landmarks:  lm,
                handedness: hand as 'Left' | 'Right',
                gesture:    stableGesture,
                pinchRatio,
              };
            });

            // Clear smoothed + history for hands that left the frame
            for (const hand of ['Left', 'Right']) {
              if (!activeHands.has(hand)) {
                delete smoothed[hand];
                pinchActive[hand]    = false;
                gestureHistory[hand] = { raw: 'None', stable: 'None', count: 0 };
              }
            }

            handsRef.current = newHands; // sync ref immediately — zero React overhead
            drawHUD(smoothedByHand, gestureByHand);
          } else {
            // No hands visible → reset everything
            for (const hand of ['Left', 'Right']) {
              delete smoothed[hand];
              pinchActive[hand]    = false;
              gestureHistory[hand] = { raw: 'None', stable: 'None', count: 0 };
            }
            // Reset slot history too
            slotHandedness[0] = { label: '', count: 0, locked: '' };
            slotHandedness[1] = { label: '', count: 0, locked: '' };
            // Clear HUD
            const hudCanvas = canvasRef.current;
            if (hudCanvas) {
              const ctx = hudCanvas.getContext('2d');
              ctx?.clearRect(0, 0, hudCanvas.width, hudCanvas.height);
            }
            handsRef.current = [];
          }

          // ── Latency: EMA-smooth and update display at 2fps (decorative number, no need to flicker) ──
          const elapsed = performance.now() - t0;
          emaLatencyRef.current = emaLatencyRef.current === 0
            ? elapsed
            : emaLatencyRef.current * 0.85 + elapsed * 0.15;
          const now = performance.now();
          if (now - lastLatencyUpdateRef.current > LATENCY_DISPLAY_INTERVAL_MS) {
            lastLatencyUpdateRef.current = now;
            setLatency(Math.round(emaLatencyRef.current));
          }
        }

        // ── Throttled hands display update for JSX overlay (~8fps max) ──
        const nowDisplay = performance.now();
        if (nowDisplay - lastHandsDisplayUpdateRef.current > HANDS_DISPLAY_INTERVAL_MS) {
          lastHandsDisplayUpdateRef.current = nowDisplay;
          setHandsDisplay([...handsRef.current]);
        }
      } catch (err) {
        console.error("MediaPipe detection loop error:", err);
      } finally {
        requestRef.current = requestAnimationFrame(predictWebcam);
      }
    }

    return () => {
      cancelAnimationFrame(requestRef.current);
      video.removeEventListener('loadeddata', predictWebcam);
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => t.stop());
      }
    };
  }, [isReady, videoRef, canvasRef]);

  return { hands: handsDisplay, handsRef, isReady, latency };
}
