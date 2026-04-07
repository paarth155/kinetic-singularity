import { useRef, useEffect, useState, useCallback } from 'react';
import { useHandTracking, type HandTrackingConfig } from './useHandTracking';

import {
  type Vector2,
  type Stroke,
  generateShapePoints,
  textToPoints,
  computeCentroid,
  computeBounds,
  decimatePoints
} from './utils/geometry';

type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  strokes: Stroke[];
};

const DEFAULT_LAYER: Layer = { id: 'layer-1', name: 'Layer 1', visible: true, locked: false, strokes: [] };

type ThemeId = 'holo-blue' | 'crimson';

function SettingsModal({
  activeTheme,
  applyTheme,
  closeModal,
  showToast,
  trackingConfig,
  setTrackingConfig
}: {
  activeTheme: ThemeId,
  applyTheme: (t: ThemeId) => void,
  closeModal: () => void,
  showToast: (m: string) => void,
  trackingConfig: HandTrackingConfig,
  setTrackingConfig: (c: HandTrackingConfig) => void
}) {
  const [draftQuality, setDraftQuality] = useState(trackingConfig.quality);
  const [draftTheme, setDraftTheme] = useState<ThemeId>(activeTheme);
  const [draftSmoothing, setDraftSmoothing] = useState(trackingConfig.smoothing);
  return (
    <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm">
      <div className="glass-panel p-8 max-w-md w-full relative border border-primary/20 shadow-[0_0_80px_rgba(143,245,255,0.1)]">
        <button onClick={closeModal} className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors"><span className="material-symbols-outlined">close</span></button>
        <h2 className="text-xl font-space-grotesk text-primary mb-6 tracking-widest uppercase">System Settings</h2>
        <div className="space-y-4 text-sm text-white/70">
          <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
            <div>
              <label className="font-space-grotesk tracking-wide text-xs uppercase block">Tracking Engine</label>
              <span className="text-[10px] text-white/30">Hand detection performance mode</span>
            </div>
            <select
              value={draftQuality}
              onChange={(e) => setDraftQuality(e.target.value as HandTrackingConfig['quality'])}
              className="bg-zinc-900 text-primary outline-none border border-primary/30 rounded-2xl px-2 py-1 text-xs"
            >
              <option value="high">High Perf</option>
              <option value="balanced">Balanced</option>
              <option value="economy">Economy</option>
            </select>
          </div>
          <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
            <div>
              <label className="font-space-grotesk tracking-wide text-xs uppercase block">Hand Smoothing</label>
              <span className="text-[10px] text-white/30">EMA filter strength (higher = smoother)</span>
            </div>
            <div className="flex items-center gap-2 w-1/2">
              <input
                type="range" min="0" max="100" value={draftSmoothing}
                className="flex-1 accent-primary"
                onChange={(e) => setDraftSmoothing(parseInt(e.target.value))}
              />
              <span className="text-[10px] text-white/40 w-6">{draftSmoothing}</span>
            </div>
          </div>
          <div className="flex justify-between items-center bg-white/5 p-4 rounded-2xl border border-white/5">
            <div>
              <label className="font-space-grotesk tracking-wide text-xs uppercase block">UI Theme</label>
              <span className="text-[10px] text-white/30">Color accent for the interface</span>
            </div>
            <select
              value={draftTheme}
              onChange={(e) => setDraftTheme(e.target.value as ThemeId)}
              className="bg-zinc-900 text-primary outline-none border border-primary/30 rounded-2xl px-2 py-1 text-xs"
            >
              <option value="holo-blue">Holo Blue</option>
              <option value="crimson">Crimson</option>
            </select>
          </div>
        </div>
        <button
          onClick={() => {
            applyTheme(draftTheme);
            setTrackingConfig({ quality: draftQuality, smoothing: draftSmoothing });
            showToast(`Settings applied: ${draftTheme} theme, ${draftQuality} engine.`);
            closeModal();
          }}
          className="mt-8 w-full bg-primary/20 hover:bg-primary text-primary hover:text-background border border-primary font-space-grotesk tracking-widest text-xs py-3 transition-colors uppercase"
        >
          Apply Changes
        </button>
      </div>
    </div>
  );
}

function DepthPanel({ brushThicknessRef }: { brushThicknessRef: React.MutableRefObject<number> }) {
  const [thickness, setThickness] = useState(brushThicknessRef.current);
  return (
    <div className="absolute left-24 top-1/2 -translate-y-1/2 glass-panel p-5 z-40 w-56 border border-primary/20 slide-in-from-left animate-in duration-300">
      <div className="flex justify-between items-center border-b border-white/5 pb-3 mb-4">
        <h3 className="text-[10px] uppercase tracking-widest font-space-grotesk text-primary opacity-60">Stroke Thickness</h3>
        <span className="text-xs text-white/50">{thickness}px</span>
      </div>
      <input type="range" min="1" max="30" value={thickness} className="w-full h-1 bg-white/20 rounded-2xl outline-none appearance-none accent-primary"
        onChange={(e) => {
          const val = parseInt(e.target.value);
          brushThicknessRef.current = val;
          setThickness(val);
        }}
      />
    </div>
  );
}

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);

  // ─── Offscreen cache for completed strokes ───────────────────────────────
  const offscreenCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const cacheInvalidRef = useRef<boolean>(true); // start dirty so first frame renders
  const prevTransformKeyRef = useRef<string>(''); // detect transform changes
  const prevHoveredIdRef = useRef<string | null>(null); // track hover changes for cache invalidation
  const pendingBakesRef = useRef<Set<string>>(new Set());
  const liveManipulationIdsRef = useRef<Set<string>>(new Set());

  // ─── Stroke index & cached visible strokes (rebuilt only when dirty) ─────
  const strokeIndexRef = useRef<Map<string, Stroke>>(new Map());
  const visibleStrokesRef = useRef<Stroke[]>([]);
  const visibleStrokesDirtyRef = useRef<boolean>(true);

  const rebuildStrokeIndex = useCallback(() => {
    const map = new Map<string, Stroke>();
    const visible: Stroke[] = [];
    for (const layer of layersRef.current) {
      for (const stroke of layer.strokes) {
        map.set(stroke.id, stroke);
      }
      // visibleStrokesRef stores interactive strokes (visible AND unlocked)
      if (layer.visible && !layer.locked) {
        for (const stroke of layer.strokes) {
          visible.push(stroke);
        }
      }
    }
    strokeIndexRef.current = map;
    visibleStrokesRef.current = visible;
    visibleStrokesDirtyRef.current = false;
  }, []);

  const [trackingConfig, setTrackingConfig] = useState<HandTrackingConfig>({ quality: 'balanced', smoothing: 50 });
  const { hands, handsRef, isReady, latency, error } = useHandTracking(videoRef, hudCanvasRef, trackingConfig);

  // ─── Layer system ───────────────────────────────────────────────────────────
  // layersRef is the mutable source-of-truth used in the RAF loop.
  // layers state is synced only when structure changes (add/delete/rename/visibility)
  // so the UI re-renders without touching the hot render path.
  const layersRef = useRef<Layer[]>([{ ...DEFAULT_LAYER, strokes: [] }]);
  const [layers, setLayers] = useState<Layer[]>(layersRef.current);
  const activeLayerIdRef = useRef<string>('layer-1');

  const syncLayersState = useCallback(() => setLayers(layersRef.current.map((l: Layer) => ({ ...l, strokes: [...l.strokes] }))), []);
  const invalidateCache = useCallback(() => { cacheInvalidRef.current = true; visibleStrokesDirtyRef.current = true; }, []);
  const invalidateRenderCache = useCallback(() => { cacheInvalidRef.current = true; }, []);

  const addLayer = () => {
    const id = `layer-${Date.now()}`;
    const name = `Layer ${layersRef.current.length + 1}`;
    const newLayer: Layer = { id, name, visible: true, locked: false, strokes: [] };
    layersRef.current = [...layersRef.current, newLayer];
    activeLayerIdRef.current = id;
    invalidateCache();
    syncLayersState();
  };

  const deleteLayer = (id: string) => {
    if (layersRef.current.length === 1) { showToast('Cannot delete the last layer'); return; }
    layersRef.current = layersRef.current.filter((l: Layer) => l.id !== id);
    // If active was deleted, pick the last remaining layer
    if (activeLayerIdRef.current === id) {
      activeLayerIdRef.current = layersRef.current[layersRef.current.length - 1].id;
    }
    invalidateCache();
    syncLayersState();
  };

  const toggleLayerVisibility = (id: string) => {
    const layer = layersRef.current.find(l => l.id === id);
    if (layer) { layer.visible = !layer.visible; invalidateCache(); syncLayersState(); }
  };
  const toggleLayerLock = (id: string) => {
    const layer = layersRef.current.find(l => l.id === id);
    if (layer) { layer.locked = !layer.locked; invalidateCache(); syncLayersState(); }
  };

  const renameLayer = (id: string, name: string) => {
    const layer = layersRef.current.find(l => l.id === id);
    if (layer) { layer.name = name; syncLayersState(); }
  };
  // ─────────────────────────────────────────────────────────────────────────

  const activeStrokeIdRef = useRef<string | null>(null);
  // Schedule a React state sync at end of the current RAF frame instead of calling syncLayersState()
  // directly inside processGestures, which would trigger reconciliation mid-draw.
  const syncScheduledRef = useRef<boolean>(false);
  const selectAllModeRef = useRef<boolean>(false);
  const [selectAllModeState, setSelectAllModeState] = useState<boolean>(false);
  const modeRef = useRef<HTMLSpanElement>(null);

  // ─── Input modes: 'hand' (default), 'mouse', 'text', 'select' ─────────────
  const [inputMode, setInputMode] = useState<'hand' | 'mouse' | 'text' | 'select'>('hand');
  const inputModeRef = useRef<'hand' | 'mouse' | 'text' | 'select'>('hand');
  // Keep ref in sync for RAF loop; also imperatively reset the hand cursor when switching modes
  useEffect(() => {
    inputModeRef.current = inputMode;
    // Imperative cursor reset: disable hand cursor immediately when switching modes
    if (inputMode !== 'hand') {
      cursorRef.current.visible = false;
      hoveredStrokeIdRef.current = null;
    }
  }, [inputMode]);


  // Mouse drawing state (managed via refs for RAF loop)
  const mouseDrawingRef = useRef<boolean>(false);
  const mouseStrokeIdRef = useRef<string | null>(null);

  // ─── Mouse select/transform state ─────────────────────────────────────────
  type DragHandle = 'body' | 'nw' | 'ne' | 'sw' | 'se' | 'rotate' | null;
  const mouseSelectedIdRef = useRef<string | null>(null);
  const mouseDragHandleRef = useRef<DragHandle>(null);
  const mouseDragStartRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDragInitTranslateRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const mouseDragInitScaleRef = useRef<number>(1);
  const mouseDragInitRotationRef = useRef<number>(0);
  const mouseDragActiveRef = useRef<boolean>(false);
  // Reactive cursor style for the select-mode canvas — updated whenever the drag handle changes
  const [mouseCursorStyle, setMouseCursorStyle] = useState<string>('default');
  // Helper: set both the ref and the reactive state together so the canvas style updates
  const setDragHandle = (handle: DragHandle) => {
    mouseDragHandleRef.current = handle;
    setMouseCursorStyle(
      handle === 'body' ? 'move'
        : handle === 'rotate' ? 'grabbing'
          : handle !== null ? 'nwse-resize'
            : 'default'
    );
  };
  // We need to expose the selected stroke's transformed bounds for handle hit-testing
  const mouseSelectionBoxRef = useRef<{ minX: number; minY: number; maxX: number; maxY: number } | null>(null);

  // Text input state
  const [showTextInput, setShowTextInput] = useState(false);
  const [textInputPos, setTextInputPos] = useState<{ x: number; y: number }>({ x: 0, y: 0 });
  const textInputRef = useRef<HTMLInputElement>(null);

  const brushColorRef = useRef<string>('#8ff5ff');
  // brushColorState mirrors brushColorRef for reactive JSX (palette swatch ring, etc.).
  // Update BOTH together wherever brushColorRef.current is written.
  const [brushColorState, setBrushColorState] = useState<string>(brushColorRef.current);
  const brushThicknessRef = useRef<number>(6);
  const globalTransformRef = useRef({ scale: 1, rotation: 0 });
  const targetParallaxRef = useRef({ x: 0, y: 0 });
  const currentParallaxRef = useRef({ x: 0, y: 0 });
  const lastAppliedParallaxRef = useRef({ x: -999, y: -999 }); // for threshold comparison
  // Cursor preview: tracks right-hand index tip on the drawing canvas
  const cursorRef = useRef<{ x: number; y: number; visible: boolean; drawing: boolean; selecting: boolean }>({
    x: 0, y: 0, visible: false, drawing: false, selecting: false
  });
  // Hovered / selected-via-proximity stroke
  const hoveredStrokeIdRef = useRef<string | null>(null);
  const penDownRippleRef = useRef<{ x: number; y: number; time: number } | null>(null);

  const [activeTab, setActiveTab] = useState<string>('Draw');
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<string | null>(null);

  // ─── Theme ───────────────────────────────────────────────────────────────────
  const [activeTheme, setActiveTheme] = useState<ThemeId>('holo-blue');
  const themeSelColorRef = useRef<string>('#8ff5ff');
  const applyTheme = useCallback((theme: ThemeId) => {
    document.documentElement.setAttribute('data-theme', theme);
    setActiveTheme(theme);
    // Swap brush cursor default color to match theme accent
    if (theme === 'crimson') {
      brushColorRef.current = brushColorRef.current === '#8ff5ff' ? '#ff4f6d' : brushColorRef.current;
      themeSelColorRef.current = '#ff4f6d';
    } else {
      brushColorRef.current = brushColorRef.current === '#ff4f6d' ? '#8ff5ff' : brushColorRef.current;
      themeSelColorRef.current = '#8ff5ff';
    }
    setBrushColorState(brushColorRef.current); // keep reactive state in sync
    invalidateCache(); // Rebuild cache with new theme selection colors
  }, [invalidateCache]);

  // trackingQuality: currently visual-only (no runtime effect), kept for future wiring

  const [toastMessage, setToastMessage] = useState<string | null>(null);
  const toastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const showToast = useCallback((msg: string) => {
    if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
    // Truncate overly long messages to prevent UI overflow (cap at 80 visible chars)
    setToastMessage(msg.length > 80 ? msg.slice(0, 79) + '…' : msg);
    toastTimerRef.current = setTimeout(() => { setToastMessage(null); toastTimerRef.current = null; }, 3000);
  }, []);

  // Manipulation state
  const leftHandState = useRef({
    initialPointer: { x: 0, y: 0 },
    initialTranslates: new Map<string, Vector2>(),
    initialScales: new Map<string, number>(),
    isGrabbing: false,
    isScaling: false,
    isRotating: false,
  });

  // Track the most recent "right hand index point" so we know when to start a new stroke vs continue
  const rightWasPointing = useRef(false);

  // Resize canvas
  useEffect(() => {
    function handleResize() {
      if (drawingCanvasRef.current) {
        drawingCanvasRef.current.width = window.innerWidth;
        drawingCanvasRef.current.height = window.innerHeight;
      }
      // Resize the offscreen canvas to match
      if (offscreenCanvasRef.current) {
        offscreenCanvasRef.current.width = window.innerWidth;
        offscreenCanvasRef.current.height = window.innerHeight;
      }
      invalidateCache();
    }
    // Create the offscreen canvas once
    if (!offscreenCanvasRef.current) {
      offscreenCanvasRef.current = document.createElement('canvas');
    }
    window.addEventListener('resize', handleResize);
    handleResize();
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Render Loop (also runs gesture logic directly from handsRef — no React cycle)
  useEffect(() => {
    let animId: number;
    const canvas = drawingCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;



    // ─── Render a single stroke to a given context ───────────────────
    // themeSelColor is read inside render() so it updates with theme switches
    let themeSelColor = '#8ff5ff';

    function renderStroke(targetCtx: CanvasRenderingContext2D, stroke: Stroke, isSelected: boolean, isHovered: boolean) {
      targetCtx.save();

      if (stroke.points.length > 0) {
        const { minX, minY, maxX, maxY } = stroke.bounds;
        const cx = minX + (maxX - minX) / 2;
        const cy = minY + (maxY - minY) / 2;

        targetCtx.translate(cx + stroke.translate.x, cy + stroke.translate.y);
        targetCtx.rotate((stroke.rotation * Math.PI) / 180);
        targetCtx.scale(stroke.scale, stroke.scale);
        targetCtx.translate(-cx, -cy);

        // Hover glow
        if (isHovered) {
          targetCtx.save();
          targetCtx.strokeStyle = 'rgba(255, 208, 0, 0.5)';
          targetCtx.lineWidth = 1;
          targetCtx.setLineDash([5, 4]);
          targetCtx.shadowColor = 'rgba(255, 208, 0, 0.4)';
          targetCtx.shadowBlur = 14;
          targetCtx.strokeRect(minX - 12, minY - 12, (maxX - minX) + 24, (maxY - minY) + 24);
          targetCtx.setLineDash([]);
          targetCtx.shadowBlur = 0;
          targetCtx.restore();
        }

        // Selection box — uses theme primary color
        if (isSelected) {
          targetCtx.save();
          targetCtx.strokeStyle = themeSelColor;
          targetCtx.globalAlpha = 0.85;
          targetCtx.lineWidth = 1.5;
          targetCtx.shadowColor = themeSelColor;
          targetCtx.shadowBlur = 24;
          targetCtx.strokeRect(minX - 10, minY - 10, (maxX - minX) + 20, (maxY - minY) + 20);
          targetCtx.shadowBlur = 0;
          targetCtx.globalAlpha = 0.9;
          const corners: [number, number][] = [
            [minX - 10, minY - 10], [maxX + 10, minY - 10],
            [minX - 10, maxY + 10], [maxX + 10, maxY + 10]
          ];
          corners.forEach(([hx, hy]) => {
            targetCtx.beginPath();
            targetCtx.arc(hx, hy, 4, 0, Math.PI * 2);
            targetCtx.fillStyle = themeSelColor;
            targetCtx.shadowColor = themeSelColor;
            targetCtx.shadowBlur = 8;
            targetCtx.fill();
            targetCtx.shadowBlur = 0;
          });
          targetCtx.globalAlpha = 1;
          targetCtx.restore();
        }
      }

      targetCtx.lineCap = 'round';
      targetCtx.lineJoin = 'round';

      // Birth animation: ramp up opacity and width over first 500ms
      const strokeAge = stroke.birthTime ? performance.now() - stroke.birthTime : Infinity;
      const birthProgress = Math.min(1, strokeAge / 500);
      const birthEase = birthProgress < 1 ? 0.3 + 0.7 * birthProgress * (2 - birthProgress) : 1;
      const baseThickness = stroke.thickness * birthEase;

      const isText = stroke.id.startsWith('text-');

      // Draw stroke
      if (stroke.points.length > 0) {
        if (isText) {
          // Render rasterized text points as glowing scatter dots
          targetCtx.fillStyle = stroke.color;
          targetCtx.shadowColor = stroke.color;
          targetCtx.shadowBlur = 10 * birthEase;
          targetCtx.globalAlpha = Math.max(0.2, birthEase);
          
          targetCtx.beginPath();
          for (let i = 0; i < stroke.points.length; i++) {
             targetCtx.moveTo(stroke.points[i].x, stroke.points[i].y);
             targetCtx.arc(stroke.points[i].x, stroke.points[i].y, 1.5, 0, Math.PI * 2);
          }
          targetCtx.fill();
        } else if (stroke.points.length < 3) {
           // Fallback for tiny dots: solid path
           targetCtx.beginPath();
           targetCtx.moveTo(stroke.points[0].x, stroke.points[0].y);
           stroke.points.forEach((p, idx) => { if (idx > 0) targetCtx.lineTo(p.x, p.y); });
           
           // 1. Ambient glow
           targetCtx.strokeStyle = stroke.color;
           targetCtx.lineWidth = baseThickness * 1.5;
           targetCtx.shadowColor = stroke.color;
           targetCtx.shadowBlur = 25 * birthEase;
           targetCtx.globalAlpha = 0.5 * birthEase;
           targetCtx.stroke();
           // 2. Main neon body
           targetCtx.lineWidth = baseThickness;
           targetCtx.shadowBlur = 10 * birthEase;
           targetCtx.globalAlpha = 0.8 * birthEase;
           targetCtx.stroke();
           // 3. Bright inner core
           if (baseThickness > 4) {
             targetCtx.strokeStyle = '#ffffff';
             targetCtx.lineWidth = baseThickness * 0.3;
             targetCtx.shadowBlur = 2;
             targetCtx.globalAlpha = birthEase;
             targetCtx.stroke();
           }
        } else {
           // Segment-by-segment drawing for dynamic width
           for (let layer = 0; layer < 3; layer++) {
             targetCtx.save();
             
             if (layer === 0) {
                 targetCtx.strokeStyle = stroke.color;
                 targetCtx.shadowColor = stroke.color;
                 targetCtx.shadowBlur = 25 * birthEase;
                 targetCtx.globalAlpha = 0.5 * birthEase;
             } else if (layer === 1) {
                 targetCtx.strokeStyle = stroke.color;
                 targetCtx.shadowColor = stroke.color;
                 targetCtx.shadowBlur = 10 * birthEase;
                 targetCtx.globalAlpha = 0.8 * birthEase;
             } else {
                 if (baseThickness <= 4) { targetCtx.restore(); continue; }
                 targetCtx.strokeStyle = '#ffffff';
                 targetCtx.shadowBlur = 2;
                 targetCtx.globalAlpha = birthEase;
             }

             // Compute dynamic width per segment
             let prevPoint = stroke.points[0];
             let i = 1;
             for (; i < stroke.points.length - 2; i++) {
                 const p1 = stroke.points[i];
                 const p2 = stroke.points[i + 1];
                 const xc = (p1.x + p2.x) / 2;
                 const yc = (p1.y + p2.y) / 2;
                 
                 // Distance represents velocity (sampled at ~60fps)
                 const dist = Math.hypot(p1.x - prevPoint.x, p1.y - prevPoint.y);
                 
                 // Normalize dist: assume 0 = max thick, 40+ = min thick
                 const speedFactor = Math.min(1, Math.max(0, dist / 40));
                 // Exponential falloff for sharper tapers
                 const thicknessScale = 1.0 - (speedFactor * 0.7); 
                 
                 // Z-depth thickness: use averaged per-point z if present, else fall back to baseThickness
                 const zThick = (p1.z !== undefined || prevPoint.z !== undefined)
                   ? ((p1.z ?? baseThickness) + (prevPoint.z ?? baseThickness)) / 2
                   : baseThickness;
                 let layerThick = zThick * thicknessScale;
                 if (layer === 0) layerThick *= 1.5;
                 else if (layer === 2) layerThick *= 0.3;
                 
                 targetCtx.beginPath();
                 targetCtx.moveTo(prevPoint.x, prevPoint.y);
                 targetCtx.quadraticCurveTo(p1.x, p1.y, xc, yc);
                 targetCtx.lineWidth = layerThick;
                 targetCtx.stroke();
                 
                 prevPoint = { x: xc, y: yc, z: p1.z }; // carry z so tail segment retains depth context
             }
             
             // Final tail segment
             const p1 = stroke.points[i];
             const p2 = stroke.points[i + 1];
             const dist = Math.hypot(p2.x - p1.x, p2.y - p1.y);
             const speedFactor = Math.min(1, Math.max(0, dist / 40));
             const thicknessScale = 1.0 - (speedFactor * 0.7);
             // Z-depth thickness for tail segment
             const tailZThick = (p1.z !== undefined || prevPoint.z !== undefined)
               ? ((p1.z ?? baseThickness) + (prevPoint.z ?? baseThickness)) / 2
               : baseThickness;
             let layerThick = tailZThick * thicknessScale;
             if (layer === 0) layerThick *= 1.5;
             else if (layer === 2) layerThick *= 0.3;
             
             targetCtx.beginPath();
             targetCtx.moveTo(prevPoint.x, prevPoint.y);
             targetCtx.quadraticCurveTo(p1.x, p1.y, p2.x, p2.y);
             targetCtx.lineWidth = layerThick;
             targetCtx.stroke();

             targetCtx.restore();
           }
        }
      }

      targetCtx.restore();
    }

    // Inverse-transform screen coordinates through the global zoom/rotate to get world-space coords.
    // Stroke points are stored in world space; the render loop applies the forward transform.

    const getMappedCoords = (lm: { x: number; y: number }) => {
      const cw = canvas?.width || window.innerWidth;
      const ch = canvas?.height || window.innerHeight;
      const vw = videoRef.current ? videoRef.current.videoWidth || 1280 : 1280;
      const vH = videoRef.current ? videoRef.current.videoHeight || 720 : 720;
      const scale = Math.max(cw / vw, ch / vH);
      const mappedW = vw * scale;
      const mappedH = vH * scale;
      const offsetX = (cw - mappedW) / 2;
      const offsetY = (ch - mappedH) / 2;
      return {
        x: offsetX + ((1 - lm.x) * mappedW),
        y: offsetY + (lm.y * mappedH)
      };
    };

    function screenToWorld(sx: number, sy: number): { x: number; y: number } {
      const t = globalTransformRef.current;
      const cw = canvas!.width / 2;
      const ch = canvas!.height / 2;
      // Undo: translate(cw,ch) → rotate → scale → translate(-cw,-ch)
      const dx = sx - cw;
      const dy = sy - ch;
      const ux = dx / t.scale;
      const uy = dy / t.scale;
      const cosR = Math.cos((-t.rotation * Math.PI) / 180);
      const sinR = Math.sin((-t.rotation * Math.PI) / 180);
      return {
        x: cw + ux * cosR - uy * sinR,
        y: ch + ux * sinR + uy * cosR,
      };
    }

    function processGestures() {
      // Guard: don't process if no hands are being tracked yet and canvas is empty.
      // Reset parallax target before returning so the canvas doesn't stay tilted.
      if (handsRef.current.length === 0 && visibleStrokesRef.current.length === 0) {
        targetParallaxRef.current = { x: 0, y: 0 };
        return;
      }
      const liveHands = handsRef.current;
      const rightHand = liveHands.find(h => h.handedness === 'Right');
      const leftHand = liveHands.find(h => h.handedness === 'Left');

      // 3D Parallax Calculation
      if (liveHands.length > 0) {
        let cx = 0, cy = 0, count = 0;
        liveHands.forEach(hand => {
          const wrist = hand.landmarks[0];
          if (wrist) {
            cx += (1 - wrist.x);
            cy += wrist.y;
            count++;
          }
        });
        if (count > 0) {
          targetParallaxRef.current = { x: ((cx / count) - 0.5) * 16, y: ((cy / count) - 0.5) * 16 };
        }
      } else {
        targetParallaxRef.current = { x: 0, y: 0 };
      }

      let currentMode = 'Idle';
      let newActiveStrokeId = activeStrokeIdRef.current;

      // Rebuild cached visible strokes + index only when dirty
      if (visibleStrokesDirtyRef.current) rebuildStrokeIndex();
      const allVisibleStrokes = visibleStrokesRef.current;

      // Find the active layer (where new strokes are created)
      const activeLayer = layersRef.current.find((l: Layer) => l.id === activeLayerIdRef.current)
        ?? layersRef.current[layersRef.current.length - 1];

      // O(1) stroke lookup via index Map
      function findStrokeById(id: string): Stroke | undefined {
        return strokeIndexRef.current.get(id);
      }

      if (rightHand) {
        const indexTip = rightHand.landmarks[8];
        const mapped = getMappedCoords(indexTip);
        const screenX = mapped.x;
        const screenY = mapped.y;
        // World-space coordinates for stroke points and hit-testing (accounts for zoom/rotate)
        const world = screenToWorld(screenX, screenY);
        const worldX = world.x;
        const worldY = world.y;

        // Cursor stays in screen space so it tracks the finger visually
        cursorRef.current = {
          x: screenX, y: screenY,
          visible: true,
          drawing: rightHand.gesture === 'IndexPoint',
          selecting: rightHand.gesture === 'Pinch',
        };

        // Hover detection (idle only) — uses cached centroids in world space
        if (rightHand.gesture === 'None') {
          let nearestId: string | null = null;
          let minScore = Number.MAX_VALUE;
          for (const s of allVisibleStrokes) {
            if (s.points.length === 0) continue;
            const d = Math.hypot(s.centroid.x + s.translate.x - worldX, s.centroid.y + s.translate.y - worldY);
            const threshold = 180 * Math.max(0.5, s.scale);
            if (d < threshold) {
              const score = d / s.scale;
              if (score < minScore) { minScore = score; nearestId = s.id; }
            }
          }
          hoveredStrokeIdRef.current = nearestId;
        } else {
          hoveredStrokeIdRef.current = null;
        }
        // Invalidate cache when hover target changes so outline renders/clears
        if (hoveredStrokeIdRef.current !== prevHoveredIdRef.current) {
          prevHoveredIdRef.current = hoveredStrokeIdRef.current;
          invalidateRenderCache();
        }

        if (rightHand.gesture === 'IndexPoint') {

          currentMode = 'Draw';
          if (!activeLayer.locked) {
            if (!rightWasPointing.current) {
              // Bake the previous cached stroke without marking the stroke index dirty.
              // visibleStrokesDirtyRef stays false — new stroke is already added to the index below.
              invalidateRenderCache();
              // Capture initial depth for first point
              const rawZ0 = rightHand.landmarks[8].z ?? 0;
              const zNorm0 = Math.max(0, Math.min(1, (-rawZ0 + 0.1) / 0.3));
              const dynThick0 = brushThicknessRef.current * (0.6 + zNorm0 * 0.8);
              const newStroke: Stroke = {
                id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                points: [{ x: worldX, y: worldY, z: dynThick0 }],
                color: brushColorRef.current,
                thickness: brushThicknessRef.current,
                scale: 1, rotation: 0, translate: { x: 0, y: 0 },
                centroid: { x: worldX, y: worldY },
                bounds: { minX: worldX, minY: worldY, maxX: worldX, maxY: worldY },
                birthTime: performance.now()
              };
              penDownRippleRef.current = { x: screenX, y: screenY, time: performance.now() };
              activeLayer.strokes.push(newStroke);
              // Add to index immediately so findStrokeById works this frame
              strokeIndexRef.current.set(newStroke.id, newStroke);
              newActiveStrokeId = newStroke.id;
              rightWasPointing.current = true;
            } else {
              // Continue the active stroke, find by id across all layers
              const activeStroke = findStrokeById(newActiveStrokeId ?? '');
              if (activeStroke && activeStroke.points.length > 0) {
                const prevPt = activeStroke.points[activeStroke.points.length - 1];
                const pointMinDist = 1.5 / globalTransformRef.current.scale;
                if (Math.hypot(prevPt.x - worldX, prevPt.y - worldY) > pointMinDist) {
                  // Compute depth-driven dynamic thickness and store in point.z
                  const rawZ = rightHand.landmarks[8].z ?? 0;
                  const zNorm = Math.max(0, Math.min(1, (-rawZ + 0.1) / 0.3));
                  const dynamicThickness = brushThicknessRef.current * (0.6 + zNorm * 0.8);
                  activeStroke.points.push({ x: worldX, y: worldY, z: dynamicThickness });
                  // Expand bounds live so renderStroke shows correct bounding box
                  const b = activeStroke.bounds;
                  if (worldX < b.minX) b.minX = worldX;
                  if (worldY < b.minY) b.minY = worldY;
                  if (worldX > b.maxX) b.maxX = worldX;
                  if (worldY > b.maxY) b.maxY = worldY;
                }
              }
            }
          }
        } else if (rightHand.gesture === 'Fist') {

          currentMode = 'Clear Canvas';
          // Clear only the active layer
          if (activeLayer.strokes.length > 0 && !activeLayer.locked) {
            activeLayer.strokes = [];
            newActiveStrokeId = null;
            // Clear stale IDs so render sets don't ghost-render deleted strokes
            pendingBakesRef.current.clear();
            liveManipulationIdsRef.current.clear();
            invalidateCache();
            syncScheduledRef.current = true;
          }
        } else if (rightHand.gesture === 'Pinch') {

          currentMode = 'Select';
          let nearestId: string | null = null;
          let minScore = Number.MAX_VALUE;
          for (const s of allVisibleStrokes) {
            if (s.points.length === 0) continue;
            const d = Math.hypot(s.centroid.x + s.translate.x - worldX, s.centroid.y + s.translate.y - worldY);
            const threshold = 220 * Math.max(0.5, s.scale);
            if (d < threshold) {
              const score = d / s.scale;
              if (score < minScore) { minScore = score; nearestId = s.id; }
            }
          }
          if (nearestId && nearestId !== newActiveStrokeId) {
            newActiveStrokeId = nearestId;
          }
        }

        // When user lifts their index finger, decimate the just-finished stroke & cache centroid
        if (rightWasPointing.current && rightHand.gesture !== 'IndexPoint') {
          const finishedStroke = findStrokeById(newActiveStrokeId ?? '');
          if (finishedStroke) {
            if (finishedStroke.points.length > 20) {
              finishedStroke.points = decimatePoints(finishedStroke.points, 1.0);
            }
            finishedStroke.centroid = computeCentroid(finishedStroke.points);
            finishedStroke.bounds = computeBounds(finishedStroke.points);
          }
          invalidateCache();
          rightWasPointing.current = false;
          syncScheduledRef.current = true; // batch the React sync to end of RAF frame
        }
      } else {
        // Right hand left the frame — finalize any in-progress stroke
        if (rightWasPointing.current) {
          const finishedStroke = findStrokeById(newActiveStrokeId ?? '');
          if (finishedStroke) {
            if (finishedStroke.points.length > 20) {
              finishedStroke.points = decimatePoints(finishedStroke.points, 1.0);
            }
            finishedStroke.centroid = computeCentroid(finishedStroke.points);
            finishedStroke.bounds = computeBounds(finishedStroke.points);
          }
          invalidateCache();
          syncScheduledRef.current = true; // batch the React sync to end of RAF frame
        }
        rightWasPointing.current = false;
        cursorRef.current.visible = false;
      }

      // Left hand manipulation — find target stroke across all layers
      let targetStrokes: Stroke[] = [];
      if (selectAllModeRef.current) {
        targetStrokes = allVisibleStrokes;
      } else {
        const ts = newActiveStrokeId ? findStrokeById(newActiveStrokeId) : (() => {
          // Fallback: last stroke in active layer
          const layer = layersRef.current.find((layer: Layer) => layer.id === activeLayerIdRef.current);
          return layer?.strokes[layer.strokes.length - 1];
        })();
        if (ts) targetStrokes.push(ts);
      }

      if (leftHand && targetStrokes.length > 0) {
        const state = leftHandState.current;
        const indexTip = leftHand.landmarks[8];
        const wrist = leftHand.landmarks[0];
        const mappedPt = getMappedCoords(indexTip);
        const ptX = mappedPt.x;
        const ptY = mappedPt.y;

        if (leftHand.gesture === 'Peace') {
          currentMode = 'Move';
          if (!state.isGrabbing) {
            state.isGrabbing = true;
            state.initialPointer = { x: ptX, y: ptY };
            targetStrokes.forEach(s => {
              state.initialTranslates.set(s.id, { ...s.translate });
              liveManipulationIdsRef.current.add(s.id);
            });
            invalidateRenderCache();
          } else {
            const dx = ptX - state.initialPointer.x;
            const dy = ptY - state.initialPointer.y;
            targetStrokes.forEach(s => {
              const init = state.initialTranslates.get(s.id);
              if (init) {
                s.translate.x = init.x + dx;
                s.translate.y = init.y + dy;
              }
            });
          }
        } else {
          if (state.isGrabbing) {
            state.initialTranslates.clear();
            liveManipulationIdsRef.current.clear();
            invalidateRenderCache();
          }
          state.isGrabbing = false;
        }

        if (leftHand.gesture === 'Pinch') {
          currentMode = 'Scale';
          const mappedCurr = getMappedCoords(indexTip);
          const currentX = mappedCurr.x;
          const currentY = mappedCurr.y;
          if (!state.isScaling) {
            state.isScaling = true;
            state.initialPointer = { x: currentX, y: currentY };
            targetStrokes.forEach(s => {
              state.initialScales.set(s.id, s.scale);
              liveManipulationIdsRef.current.add(s.id);
            });
            invalidateRenderCache();
          } else {
            const dX = state.initialPointer.x - currentX;
            const dY = state.initialPointer.y - currentY;
            // 2D drag: magnitude drives scale size, primary axis sets sign (pull = shrink, push = grow)
            const rawMag = Math.hypot(dX, dY);
            const sign = Math.abs(dX) >= Math.abs(dY) ? Math.sign(dX) : Math.sign(dY);
            const scaleFactor = 1 + (sign * rawMag / 200);
            targetStrokes.forEach(s => {
              const init = state.initialScales.get(s.id) || 1;
              s.scale = Math.max(0.05, Math.min(12, init * scaleFactor));
            });
          }
        } else {
          if (state.isScaling) {
            state.initialScales.clear();
            liveManipulationIdsRef.current.clear();
            invalidateRenderCache();
          }
          state.isScaling = false;
        }

        if (leftHand.gesture === 'OpenPalm') {
          currentMode = 'Rotate';
          const mirrorIndexX = 1 - indexTip.x;
          const mirrorWristX = 1 - wrist.x;
          const angle = Math.atan2(indexTip.y - wrist.y, mirrorIndexX - mirrorWristX) * (180 / Math.PI);
          const snappedAngle = Math.round(angle / 45) * 45;
          
          if (!state.isRotating) {
            state.isRotating = true;
            targetStrokes.forEach(s => liveManipulationIdsRef.current.add(s.id));
            invalidateRenderCache();
          }
          targetStrokes.forEach(s => { s.rotation = snappedAngle; });
        } else {
          if (state.isRotating) {
            liveManipulationIdsRef.current.clear();
            invalidateRenderCache();
          }
          state.isRotating = false;
        }
      } else if (leftHand) {
        if (leftHandState.current.isGrabbing || leftHandState.current.isScaling || leftHandState.current.isRotating) {
           liveManipulationIdsRef.current.clear();
           invalidateRenderCache();
        }
        leftHandState.current.isGrabbing = false;
        leftHandState.current.isScaling = false;
        leftHandState.current.isRotating = false;
      } else {
        // No left hand visible — fully reset manipulation state to prevent stale grabs
        if (leftHandState.current.isGrabbing || leftHandState.current.isScaling || leftHandState.current.isRotating) {
           liveManipulationIdsRef.current.clear();
           invalidateRenderCache();
        }
        leftHandState.current.isGrabbing = false;
        leftHandState.current.isScaling = false;
        leftHandState.current.isRotating = false;
        leftHandState.current.initialTranslates.clear();
        leftHandState.current.initialScales.clear();
      }

      // strokesChanged flag is used for dirty tracking; writing back to layersRef is done in-place above
      if (activeStrokeIdRef.current !== newActiveStrokeId) activeStrokeIdRef.current = newActiveStrokeId;
      if (modeRef.current && modeRef.current.textContent !== currentMode + ' Mode') {
        modeRef.current.textContent = currentMode + ' Mode';
      }
    }

    function render() {
      // Process gestures here — same frame as drawing, no React cycle
      processGestures();

      // Re-read theme color only when cache rebuilds (selection boxes are drawn there)
      if (cacheInvalidRef.current) {
        themeSelColor = themeSelColorRef.current;
      }

      const pCurrent = currentParallaxRef.current;
      const pTarget = targetParallaxRef.current;
      pCurrent.x += (pTarget.x - pCurrent.x) * 0.06;
      pCurrent.y += (pTarget.y - pCurrent.y) * 0.06;
      // Only update DOM transform when parallax changes visibly (>0.01 deg)
      const lastP = lastAppliedParallaxRef.current;
      if (Math.abs(pCurrent.x - lastP.x) > 0.01 || Math.abs(pCurrent.y - lastP.y) > 0.01) {
        canvas!.style.transform = `rotateX(${-pCurrent.y}deg) rotateY(${pCurrent.x}deg) scale(1.02)`;
        lastP.x = pCurrent.x;
        lastP.y = pCurrent.y;
      }

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);

      const currentActiveId = activeStrokeIdRef.current;
      const t = globalTransformRef.current;

      // ─── Build transform key to detect view changes ────────────────
      const transformKey = `${t.scale}_${t.rotation}`;
      if (transformKey !== prevTransformKeyRef.current) {
        prevTransformKeyRef.current = transformKey;
        cacheInvalidRef.current = true;
      }

      // ─── Collect all visible strokes, separate active from completed ─
      const activeDrawingId = rightWasPointing.current ? currentActiveId : null;
      const mouseSelId = mouseSelectedIdRef.current;

      ctx!.save();

      // Global View Transform
      const cw = canvas!.width / 2;
      const ch = canvas!.height / 2;
      ctx!.translate(cw, ch);
      ctx!.rotate((t.rotation * Math.PI) / 180);
      ctx!.scale(t.scale, t.scale);
      ctx!.translate(-cw, -ch);

      // ─── Rebuild offscreen cache if dirty ──────────────────────────
      const offscreen = offscreenCanvasRef.current;
      const now = performance.now();

      if (offscreen && cacheInvalidRef.current) {
        const oCtx = offscreen.getContext('2d');
        if (oCtx) {
          oCtx.clearRect(0, 0, offscreen.width, offscreen.height);
          oCtx.save();
          // Apply same global transform to offscreen
          oCtx.translate(cw, ch);
          oCtx.rotate((t.rotation * Math.PI) / 180);
          oCtx.scale(t.scale, t.scale);
          oCtx.translate(-cw, -ch);

          layersRef.current.filter(l => l.visible).forEach(layer => {
            layer.strokes.forEach(stroke => {
              // Skip actively-being-drawn, animating strokes, and strokes being manipulated live
              const isAnimating = now - stroke.birthTime < 1500;
              if (stroke.id === activeDrawingId || isAnimating || liveManipulationIdsRef.current.has(stroke.id)) {
                if (isAnimating) pendingBakesRef.current.add(stroke.id);
                return;
              }
              const isSelected = selectAllModeRef.current || stroke.id === currentActiveId;
              const isHovered = !selectAllModeRef.current && stroke.id === hoveredStrokeIdRef.current && !isSelected;
              renderStroke(oCtx, stroke, isSelected, isHovered);
            });
          });
          oCtx.restore();
        }
        cacheInvalidRef.current = false;
      }

      // ─── Draw the cached bitmap (completed strokes) ────────────────
      ctx!.restore(); // restore global transform temporarily to draw image at screen coords
      if (offscreen) {
        ctx!.drawImage(offscreen, 0, 0);
      }

      // ─── Draw the active in-progress stroke & animating strokes live ───────────────────
      ctx!.save();
      ctx!.translate(cw, ch);
      ctx!.rotate((t.rotation * Math.PI) / 180);
      ctx!.scale(t.scale, t.scale);
      ctx!.translate(-cw, -ch);

      let needsBake = false;

      if (activeDrawingId) {
        // Find the active stroke via O(1) Map lookup
        const activeStroke = strokeIndexRef.current.get(activeDrawingId);
        if (activeStroke) {
          const isSelected = selectAllModeRef.current || activeStroke.id === currentActiveId;
          renderStroke(ctx!, activeStroke, isSelected, false);
        }
      }

      if (pendingBakesRef.current.size > 0) {
        for (const strokeId of pendingBakesRef.current) {
          if (strokeId === activeDrawingId) continue;
          const stroke = strokeIndexRef.current.get(strokeId);
          if (stroke) {
            const age = now - stroke.birthTime;
            if (age < 1500) {
              const isSelected = selectAllModeRef.current || stroke.id === currentActiveId;
              const isHovered = !selectAllModeRef.current && stroke.id === hoveredStrokeIdRef.current && !isSelected;
              renderStroke(ctx!, stroke, isSelected, isHovered);
            } else {
              pendingBakesRef.current.delete(strokeId);
              needsBake = true;
            }
          } else {
            pendingBakesRef.current.delete(strokeId);
          }
        }
      }

      if (liveManipulationIdsRef.current.size > 0) {
        for (const strokeId of liveManipulationIdsRef.current) {
          if (strokeId === activeDrawingId) continue;
          const stroke = strokeIndexRef.current.get(strokeId);
          if (stroke) {
            const isSelected = selectAllModeRef.current || stroke.id === currentActiveId;
            const isHovered = !selectAllModeRef.current && stroke.id === hoveredStrokeIdRef.current && !isSelected;
            renderStroke(ctx!, stroke, isSelected, isHovered);
          }
        }
      }

      ctx!.restore();

      if (needsBake) invalidateRenderCache();

      // (global transform already restored above via ctx!.restore())

      // Draw cursor AFTER restoring global transform so it's always in screen space
      const cursor = cursorRef.current;
      if (cursor.visible) {
        const r = cursor.drawing ? 5 : cursor.selecting ? 10 : 14;
        const color = cursor.selecting ? '#ffd000' : brushColorRef.current;

        ctx!.save();
        ctx!.beginPath();
        ctx!.arc(cursor.x, cursor.y, r, 0, Math.PI * 2);
        ctx!.strokeStyle = color;
        ctx!.lineWidth = 2;
        ctx!.shadowColor = color;
        ctx!.shadowBlur = cursor.drawing ? 8 : 20;
        ctx!.stroke();

        if (!cursor.drawing) {
          // Crosshair lines in idle mode so user can aim precisely
          ctx!.beginPath();
          ctx!.moveTo(cursor.x - 20, cursor.y);
          ctx!.lineTo(cursor.x + 20, cursor.y);
          ctx!.moveTo(cursor.x, cursor.y - 20);
          ctx!.lineTo(cursor.x, cursor.y + 20);
          ctx!.strokeStyle = color;
          ctx!.lineWidth = 1;
          ctx!.globalAlpha = 0.5;
          ctx!.shadowBlur = 6;
          ctx!.stroke();
          ctx!.globalAlpha = 1;
        } else {
          // Solid center dot when drawing
          ctx!.beginPath();
          ctx!.arc(cursor.x, cursor.y, 2.5, 0, Math.PI * 2);
          ctx!.fillStyle = color;
          ctx!.shadowBlur = 10;
          ctx!.fill();
        }
        ctx!.shadowBlur = 0;
        ctx!.restore();
      }

      // Pen-down ripple effect
      const ripple = penDownRippleRef.current;
      if (ripple) {
        const rippleAge = performance.now() - ripple.time;
        const rippleDuration = 600;
        if (rippleAge < rippleDuration) {
          const progress = rippleAge / rippleDuration;
          const eased = progress * (2 - progress);
          const radius = 4 + eased * 35;
          const opacity = (1 - eased) * 0.7;
          ctx!.save();
          ctx!.beginPath();
          ctx!.arc(ripple.x, ripple.y, radius, 0, Math.PI * 2);
          ctx!.strokeStyle = brushColorRef.current;
          ctx!.lineWidth = 2 * (1 - progress);
          ctx!.globalAlpha = opacity;
          ctx!.shadowColor = brushColorRef.current;
          ctx!.shadowBlur = 20 * (1 - progress);
          ctx!.stroke();
          ctx!.beginPath();
          ctx!.arc(ripple.x, ripple.y, radius * 0.5, 0, Math.PI * 2);
          ctx!.lineWidth = 1;
          ctx!.globalAlpha = opacity * 0.5;
          ctx!.stroke();
          ctx!.restore();
        } else {
          penDownRippleRef.current = null;
        }
      }

      // ─── Mouse-select handles (drawn in screen space) ─────────────────
      if (inputModeRef.current === 'select' && mouseSelId) {
        const selStroke = strokeIndexRef.current.get(mouseSelId);
        if (selStroke && selStroke.points.length > 0) {
          const { minX, minY, maxX, maxY } = selStroke.bounds;
          const bCx = minX + (maxX - minX) / 2;
          const bCy = minY + (maxY - minY) / 2;

          // Apply stroke transforms to compute screen-space box
          const pad = 14;
          const s = selStroke.scale;
          const tx = selStroke.translate.x;
          const ty = selStroke.translate.y;
          const hw = ((maxX - minX) / 2 + pad) * s;
          const hh = ((maxY - minY) / 2 + pad) * s;
          const cx2 = bCx + tx;
          const cy2 = bCy + ty;
          const sMinX = cx2 - hw;
          const sMinY = cy2 - hh;
          const sMaxX = cx2 + hw;
          const sMaxY = cy2 + hh;

          // Store for hit-testing in pointer events
          mouseSelectionBoxRef.current = { minX: sMinX, minY: sMinY, maxX: sMaxX, maxY: sMaxY };

          const rotRad = (selStroke.rotation * Math.PI) / 180;

          ctx!.save();
          ctx!.translate(cx2, cy2);
          ctx!.rotate(rotRad);

          // Bounding box
          ctx!.strokeStyle = themeSelColor;
          ctx!.lineWidth = 1.5;
          ctx!.setLineDash([6, 4]);
          ctx!.shadowColor = themeSelColor;
          ctx!.shadowBlur = 12;
          ctx!.strokeRect(-hw, -hh, hw * 2, hh * 2);
          ctx!.setLineDash([]);
          ctx!.shadowBlur = 0;

          // Corner resize handles
          const corners: [number, number][] = [[-hw, -hh], [hw, -hh], [-hw, hh], [hw, hh]];
          corners.forEach(([hx, hy]) => {
            ctx!.beginPath();
            ctx!.arc(hx, hy, 6, 0, Math.PI * 2);
            ctx!.fillStyle = '#0c0e12';
            ctx!.fill();
            ctx!.beginPath();
            ctx!.arc(hx, hy, 6, 0, Math.PI * 2);
            ctx!.strokeStyle = themeSelColor;
            ctx!.lineWidth = 2;
            ctx!.shadowColor = themeSelColor;
            ctx!.shadowBlur = 10;
            ctx!.stroke();
            ctx!.shadowBlur = 0;
          });

          // Rotation handle (above top center)
          const rotHandleY = -hh - 30;
          // Stem line
          ctx!.beginPath();
          ctx!.moveTo(0, -hh);
          ctx!.lineTo(0, rotHandleY);
          ctx!.strokeStyle = themeSelColor;
          ctx!.lineWidth = 1;
          ctx!.globalAlpha = 0.6;
          ctx!.stroke();
          ctx!.globalAlpha = 1;
          // Rotation circle
          ctx!.beginPath();
          ctx!.arc(0, rotHandleY, 8, 0, Math.PI * 2);
          ctx!.fillStyle = '#0c0e12';
          ctx!.fill();
          ctx!.beginPath();
          ctx!.arc(0, rotHandleY, 8, 0, Math.PI * 2);
          ctx!.strokeStyle = '#ffd000';
          ctx!.lineWidth = 2;
          ctx!.shadowColor = '#ffd000';
          ctx!.shadowBlur = 12;
          ctx!.stroke();
          ctx!.shadowBlur = 0;
          // Rotation icon
          ctx!.beginPath();
          ctx!.arc(0, rotHandleY, 4, -Math.PI * 0.3, Math.PI * 1.2);
          ctx!.strokeStyle = '#ffd000';
          ctx!.lineWidth = 1.5;
          ctx!.stroke();

          ctx!.restore();
        } else {
          mouseSelectionBoxRef.current = null;
        }
      } else {
        mouseSelectionBoxRef.current = null;
      }

      // Dispatch any pending React state sync exactly once per frame, after all canvas ops
      if (syncScheduledRef.current) {
        syncScheduledRef.current = false;
        syncLayersState();
      }

      animId = requestAnimationFrame(render);
    }
    render();

    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="bg-[#FAFAFA] text-on-surface h-screen w-screen overflow-hidden relative flex flex-col">
      {/* TopAppBar */}
      <header className="absolute top-0 left-0 w-full flex justify-between items-center px-12 h-20 z-50 bg-transparent border-b border-black/5">
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-black/80 border border-primary/40 backdrop-blur-xl px-6 py-3 text-primary text-sm font-space-grotesk tracking-wider animate-in fade-in slide-in-from-top-4 duration-300 shadow-[0_0_20px_rgba(143,245,255,0.2)]">
            {toastMessage}
          </div>
        )}

        <div className="text-xl font-bold tracking-widest text-primary space-grotesk">KINETIC_SINGULARITY</div>
        <nav className="flex gap-8">
          <a onClick={(e) => { e.preventDefault(); setActiveTab('Draw'); }} className={`cursor-pointer font-space-grotesk tracking-tight text-sm uppercase transition-all duration-300 ${activeTab === 'Draw' ? 'text-primary border-b border-primary pb-1' : 'text-slate-400 hover:text-[#003D6A]'}`} href="#">Draw</a>
          <a onClick={(e) => { e.preventDefault(); setActiveTab('Layers'); }} className={`cursor-pointer font-space-grotesk tracking-tight text-sm uppercase transition-all duration-300 ${activeTab === 'Layers' ? 'text-primary border-b border-primary pb-1' : 'text-slate-400 hover:text-[#003D6A]'}`} href="#">Layers</a>
          <a onClick={(e) => { e.preventDefault(); setActiveTab('Assets'); }} className={`cursor-pointer font-space-grotesk tracking-tight text-sm uppercase transition-all duration-300 ${activeTab === 'Assets' ? 'text-primary border-b border-primary pb-1' : 'text-slate-400 hover:text-[#003D6A]'}`} href="#">Assets</a>
        </nav>
        <div className="flex items-center gap-6">
          <button onClick={() => setActiveModal('Settings')} className={`transition-all ${activeModal === 'Settings' ? 'text-primary' : 'text-slate-400 hover:text-[#003D6A]'}`}>
            <span className="material-symbols-outlined">settings</span>
          </button>
          <button onClick={() => setActiveModal('History')} className={`transition-all ${activeModal === 'History' ? 'text-primary' : 'text-slate-400 hover:text-[#003D6A]'}`} title="Canvas Info">
            <span className="material-symbols-outlined">info</span>
          </button>
          <button onClick={() => { navigator.clipboard.writeText(window.location.href); showToast('Project link copied to clipboard!'); }} className="text-slate-400 hover:text-[#003D6A] transition-all">
            <span className="material-symbols-outlined">share</span>
          </button>
          <div className="w-8 h-8 bg-surface-container-highest flex items-center justify-center">
            <img alt="User profile" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBqjJFKVaIMYLouxbZp3BQALG3vfhajeyj8c85awuG_DnoOD9jyO8vSFF8FIu6x83AscnIOURaGEnlj22bGVcXMMXAD0WSrbsiNUHlAePQMp4epReXungnGpDp4SgkPb4za6kjcxA16TdraC92V0QfcjsgR0euz53Cdv7WV3FPuQOFk_IAEx9aF99mx_rybzRqqpFmtgIKgB35pF0Q7c1V-F0mBqlm-I1dTC4F8KaGNUtjtRy-fMtYnSqwmXXkfRDuWH9Kc7cC4tPJy" />
          </div>
        </div>
      </header>

      {/* SideNavBar */}
      <aside className="absolute left-8 top-1/2 -translate-y-1/2 bg-white border border-black/5 flex flex-col py-6 px-3 gap-2 z-40 shadow-[0_10px_30px_rgba(0,61,106,0.08)] rounded-[2rem]">
        <nav className="flex-1 flex flex-col gap-2">
          {/* Select tool */}
          <div onClick={() => {
            const next = inputMode === 'select' ? 'hand' : 'select';
            setInputMode(next);
            mouseDrawingRef.current = false; mouseStrokeIdRef.current = null;
            if (next !== 'select') { mouseSelectedIdRef.current = null; mouseDragActiveRef.current = false; invalidateCache(); }
            showToast(next === 'select' ? 'Select mode — click to select, drag to move/resize/rotate' : 'Hand tracking mode restored');
          }} className={`py-4 flex flex-col items-center justify-center cursor-pointer transition-colors group ${inputMode === 'select' ? 'bg-[#34C1FA] text-white rounded-full shadow-lg shadow-[#34C1FA]/30' : 'text-slate-400 hover:bg-black/5 hover:text-[#003D6A]'}`}>
            <span className="material-symbols-outlined mb-1">arrow_selector_tool</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Select</span>
          </div>
          <div onClick={() => setActiveSidebarPanel(activeSidebarPanel === 'Brushes' ? null : 'Brushes')} className={`py-4 flex flex-col items-center justify-center cursor-pointer transition-colors group ${activeSidebarPanel === 'Brushes' ? 'bg-[#34C1FA] text-white rounded-full shadow-lg shadow-[#34C1FA]/30' : 'text-slate-400 hover:bg-black/5 hover:text-[#003D6A]'}`}>
            <span className="material-symbols-outlined mb-1">brush</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Brushes</span>
          </div>
          {/* Mouse Draw toggle */}
          <div onClick={() => {
            const next = inputMode === 'mouse' ? 'hand' : 'mouse';
            setInputMode(next);
            // Finalize any in-progress mouse stroke so it has correct centroid/bounds
            if (mouseDrawingRef.current) {
              const abandonedStroke = strokeIndexRef.current.get(mouseStrokeIdRef.current ?? '');
              if (abandonedStroke) {
                if (abandonedStroke.points.length > 20) abandonedStroke.points = decimatePoints(abandonedStroke.points, 1.0);
                abandonedStroke.centroid = computeCentroid(abandonedStroke.points);
                abandonedStroke.bounds = computeBounds(abandonedStroke.points);
              }
              invalidateCache();
              syncLayersState();
            }
            mouseDrawingRef.current = false; mouseStrokeIdRef.current = null;
            showToast(next === 'mouse' ? 'Mouse drawing enabled — click & drag to draw' : 'Hand tracking mode restored');
          }} className={`py-4 flex flex-col items-center justify-center cursor-pointer transition-colors group ${inputMode === 'mouse' ? 'bg-[#34C1FA] text-white rounded-full shadow-lg shadow-[#34C1FA]/30' : 'text-slate-400 hover:bg-black/5 hover:text-[#003D6A]'}`}>
            <span className="material-symbols-outlined mb-1">draw</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Mouse</span>
          </div>
          {/* Text tool */}
          <div onClick={() => {
            const next = inputMode === 'text' ? 'hand' : 'text';
            setInputMode(next);
            mouseDrawingRef.current = false; mouseStrokeIdRef.current = null;
            showToast(next === 'text' ? 'Text tool active — click canvas to place text' : 'Hand tracking mode restored');
          }} className={`py-4 flex flex-col items-center justify-center cursor-pointer transition-colors group ${inputMode === 'text' ? 'bg-[#34C1FA] text-white rounded-full shadow-lg shadow-[#34C1FA]/30' : 'text-slate-400 hover:bg-black/5 hover:text-[#003D6A]'}`}>
            <span className="material-symbols-outlined mb-1">text_fields</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Text</span>
          </div>
          <div onClick={() => setActiveModal('Gestures')} className="text-slate-400 py-4 flex flex-col items-center justify-center hover:bg-black/5 hover:text-[#003D6A] transition-colors cursor-pointer group rounded-full">
            <span className="material-symbols-outlined mb-1">gesture</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Gestures</span>
          </div>
          <div onClick={() => setActiveSidebarPanel(activeSidebarPanel === 'Depth' ? null : 'Depth')} className={`py-4 flex flex-col items-center justify-center cursor-pointer transition-colors group ${activeSidebarPanel === 'Depth' ? 'bg-[#34C1FA] text-white rounded-full shadow-lg shadow-[#34C1FA]/30' : 'text-slate-400 hover:bg-black/5 hover:text-[#003D6A]'}`}>
            <span className="material-symbols-outlined mb-1">layers</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Depth</span>
          </div>
          <div onClick={() => {
            const exportCanvas = drawingCanvasRef.current;
            if (exportCanvas) {
              const bgCanvas = document.createElement('canvas');
              bgCanvas.width = exportCanvas.width;
              bgCanvas.height = exportCanvas.height;
              const bctx = bgCanvas.getContext('2d');
              if (bctx) {
                bctx.fillStyle = '#0a0a0a';
                bctx.fillRect(0, 0, bgCanvas.width, bgCanvas.height);

                // Synchronously render all strokes directly onto the export canvas
                bctx.save();
                const cw = bgCanvas.width / 2;
                const ch = bgCanvas.height / 2;
                const t = globalTransformRef.current;
                bctx.translate(cw, ch);
                bctx.rotate((t.rotation * Math.PI) / 180);
                bctx.scale(t.scale, t.scale);
                bctx.translate(-cw, -ch);

                layersRef.current.filter(l => l.visible).forEach(layer => {
                  layer.strokes.forEach(stroke => {
                    if (stroke.points.length === 0) return;
                    bctx.save();
                    const { minX, minY, maxX, maxY } = stroke.bounds;
                    const cx = minX + (maxX - minX) / 2;
                    const cy = minY + (maxY - minY) / 2;
                    bctx.translate(cx + stroke.translate.x, cy + stroke.translate.y);
                    bctx.rotate((stroke.rotation * Math.PI) / 180);
                    bctx.scale(stroke.scale, stroke.scale);
                    bctx.translate(-cx, -cy);

                    if (stroke.id.startsWith('text-')) {
                       bctx.fillStyle = stroke.color;
                       bctx.beginPath();
                       for (let i = 0; i < stroke.points.length; i++) {
                          bctx.moveTo(stroke.points[i].x, stroke.points[i].y);
                          bctx.arc(stroke.points[i].x, stroke.points[i].y, 1.5, 0, Math.PI * 2);
                       }
                       bctx.fill();
                    } else if (stroke.points.length > 0) {
                      bctx.beginPath();
                      bctx.moveTo(stroke.points[0].x, stroke.points[0].y);
                      if (stroke.points.length < 3) {
                        stroke.points.forEach((p, idx) => {
                          if (idx > 0) bctx.lineTo(p.x, p.y);
                        });
                      } else {
                        let i = 1;
                        for (; i < stroke.points.length - 2; i++) {
                          const xc = (stroke.points[i].x + stroke.points[i + 1].x) / 2;
                          const yc = (stroke.points[i].y + stroke.points[i + 1].y) / 2;
                          bctx.quadraticCurveTo(stroke.points[i].x, stroke.points[i].y, xc, yc);
                        }
                        bctx.quadraticCurveTo(
                          stroke.points[i].x, stroke.points[i].y,
                          stroke.points[i + 1].x, stroke.points[i + 1].y
                        );
                      }
                      bctx.strokeStyle = stroke.color;
                      bctx.lineWidth = stroke.thickness;
                      bctx.lineCap = 'round';
                      bctx.lineJoin = 'round';
                      bctx.stroke();
                    }
                    bctx.restore();
                  });
                });
                bctx.restore();

                const url = bgCanvas.toDataURL('image/png');
                const a = document.createElement('a');
                a.href = url;
                a.download = 'kinetic-singularity-export.png';
                a.click();
                showToast('Canvas exported as PNG');
              }
            }

          }} className="text-slate-400 py-4 flex flex-col items-center justify-center hover:bg-black/5 hover:text-[#003D6A] transition-colors cursor-pointer group rounded-full">
            <span className="material-symbols-outlined mb-1">ios_share</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Export</span>
          </div>
        </nav>
        <div className="px-2">
          <button onClick={() => {
            showToast('Recalibrating sensors and clearing canvas...');
            layersRef.current.forEach(l => { l.strokes = []; });
            activeStrokeIdRef.current = null;
            rightWasPointing.current = false;         // prevent stale finalize on next hand gesture
            pendingBakesRef.current.clear();           // prevent ghost renders of cleared strokes
            liveManipulationIdsRef.current.clear();    // prevent ghost renders of cleared strokes
            globalTransformRef.current = { scale: 1, rotation: 0 };
            invalidateCache();
            rebuildStrokeIndex();                      // wipe stale strokeIndexRef entries
            syncLayersState(); // reflect cleared stroke counts in UI
          }} className="w-full py-2 bg-[#FF3B30]/10 text-[#FF3B30] text-[10px] font-bold space-grotesk tracking-widest hover:bg-[#FF3B30] hover:text-white active:bg-[#FF3B30]/80 rounded-full transition-all">
            CALIBRATE
          </button>
        </div>
      </aside>

      {/* Main Canvas Area */}
      <main className="absolute inset-0 z-0 overflow-hidden canvas-grid rounded-[3rem]">
        <div className="absolute inset-0 z-0 flex items-center justify-center" style={{ perspective: '1200px' }}>
          <canvas
            ref={drawingCanvasRef}
            id="drawing-canvas"
            className="w-full h-full origin-center"
            style={{
              cursor: inputMode === 'mouse' ? 'crosshair'
                : inputMode === 'text' ? 'text'
                  : inputMode === 'select' ? mouseCursorStyle
                    : 'default'
            }}
            onPointerDown={(e) => {
              // Only handle primary button (left click)
              if (e.button !== 0) return;
              const canvasEl = e.currentTarget;
              // ── Text mode ──
              if (inputModeRef.current === 'text') {
                const rect = canvasEl.getBoundingClientRect();
                setTextInputPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
                setShowTextInput(true);
                // autoFocus on <input> handles focus — no redundant setTimeout needed
                return;
              }
              // ── Select mode ──
              if (inputModeRef.current === 'select') {
                const rect = canvasEl.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;

                // Helper: transform screen point into the selected stroke's LOCAL space
                // (inverse translate, then inverse rotate around box center)
                const selStroke = mouseSelectedIdRef.current ? strokeIndexRef.current.get(mouseSelectedIdRef.current) : undefined;
                if (selStroke && selStroke.points.length > 0) {
                  const box = mouseSelectionBoxRef.current;
                  if (box) {
                    const { minX: bx1, minY: by1, maxX: bx2, maxY: by2 } = box;
                    const bCx = (bx1 + bx2) / 2;
                    const bCy = (by1 + by2) / 2;
                    const hw = (bx2 - bx1) / 2;
                    const hh = (by2 - by1) / 2;

                    // Inverse-rotate click point around box center to account for stroke rotation
                    const rotRad = -(selStroke.rotation * Math.PI) / 180;
                    const dx0 = sx - bCx;
                    const dy0 = sy - bCy;
                    const lx = dx0 * Math.cos(rotRad) - dy0 * Math.sin(rotRad);
                    const ly = dx0 * Math.sin(rotRad) + dy0 * Math.cos(rotRad);

                    // Rotation handle hit-test (top center, 30px above box in local space)
                    const rotHandleY = -hh - 30;
                    if (Math.hypot(lx - 0, ly - rotHandleY) < 14) {
                      setDragHandle('rotate');
                      mouseDragStartRef.current = { x: sx, y: sy };
                      mouseDragInitRotationRef.current = selStroke.rotation;
                      mouseDragActiveRef.current = true;
                      canvasEl.setPointerCapture(e.pointerId);
                      return;
                    }
                    // Corner handle hit-tests (in local rotated space)
                    const handleHitR = 12;
                    const cornerMap: { handle: DragHandle; lx: number; ly: number }[] = [
                      { handle: 'nw', lx: -hw, ly: -hh },
                      { handle: 'ne', lx: hw, ly: -hh },
                      { handle: 'sw', lx: -hw, ly: hh },
                      { handle: 'se', lx: hw, ly: hh },
                    ];
                    for (const c of cornerMap) {
                      if (Math.hypot(lx - c.lx, ly - c.ly) < handleHitR) {
                        setDragHandle(c.handle as DragHandle);
                        mouseDragStartRef.current = { x: sx, y: sy };
                        mouseDragInitScaleRef.current = selStroke.scale;
                        mouseDragActiveRef.current = true;
                        canvasEl.setPointerCapture(e.pointerId);
                        return;
                      }
                    }
                    // Body drag (inside bounding box in local rotated space)
                    if (lx >= -hw && lx <= hw && ly >= -hh && ly <= hh) {
                      setDragHandle('body');
                      mouseDragStartRef.current = { x: sx, y: sy };
                      mouseDragInitTranslateRef.current = { ...selStroke.translate };
                      mouseDragActiveRef.current = true;
                      canvasEl.setPointerCapture(e.pointerId);
                      return;
                    }
                  }
                }

                // Not on any handle — try to select a new stroke by proximity
                // Centroids are stored in world space; convert click to world space first.
                if (visibleStrokesDirtyRef.current) rebuildStrokeIndex();
                const allVisible = visibleStrokesRef.current;
                const t2 = globalTransformRef.current;
                const cw2 = (drawingCanvasRef.current?.width ?? window.innerWidth) / 2;
                const ch2 = (drawingCanvasRef.current?.height ?? window.innerHeight) / 2;
                const ddx = sx - cw2, ddy = sy - ch2;
                const cosR2 = Math.cos((-t2.rotation * Math.PI) / 180);
                const sinR2 = Math.sin((-t2.rotation * Math.PI) / 180);
                const worldClickX = cw2 + (ddx / t2.scale) * cosR2 - (ddy / t2.scale) * sinR2;
                const worldClickY = ch2 + (ddx / t2.scale) * sinR2 + (ddy / t2.scale) * cosR2;
                let nearestId: string | null = null;
                let nearestDist = 180;
                for (const s of allVisible) {
                  if (s.points.length === 0) continue;
                  const d = Math.hypot(s.centroid.x + s.translate.x - worldClickX, s.centroid.y + s.translate.y - worldClickY);
                  if (d < nearestDist) { nearestDist = d; nearestId = s.id; }
                }
                mouseSelectedIdRef.current = nearestId;
                activeStrokeIdRef.current = nearestId;
                setDragHandle(null);
                mouseDragActiveRef.current = false;
                invalidateCache();
                return;
              }
              // ── Mouse draw mode ──
              if (inputModeRef.current !== 'mouse') return;
              const rect = canvasEl.getBoundingClientRect();
              const sx = e.clientX - rect.left;
              const sy = e.clientY - rect.top;
              const activeLayer = layersRef.current.find((l: Layer) => l.id === activeLayerIdRef.current)
                ?? layersRef.current[layersRef.current.length - 1];
              if (activeLayer.locked) return;
              const newStroke: Stroke = {
                id: `mouse-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
                points: [{ x: sx, y: sy }],
                color: brushColorRef.current,
                thickness: brushThicknessRef.current,
                scale: 1, rotation: 0, translate: { x: 0, y: 0 },
                centroid: { x: sx, y: sy },
                bounds: { minX: sx, minY: sy, maxX: sx, maxY: sy },
                birthTime: performance.now(),
              };
              activeLayer.strokes.push(newStroke);
              strokeIndexRef.current.set(newStroke.id, newStroke);
              mouseStrokeIdRef.current = newStroke.id;
              activeStrokeIdRef.current = newStroke.id;
              mouseDrawingRef.current = true;
              penDownRippleRef.current = { x: sx, y: sy, time: performance.now() };
              invalidateCache();
              canvasEl.setPointerCapture(e.pointerId);
            }}
            onPointerMove={(e) => {
              // ── Select mode drag ──
              if (inputModeRef.current === 'select' && mouseDragActiveRef.current) {
                const rect = e.currentTarget.getBoundingClientRect();
                const sx = e.clientX - rect.left;
                const sy = e.clientY - rect.top;
                const selStroke = mouseSelectedIdRef.current ? strokeIndexRef.current.get(mouseSelectedIdRef.current) : undefined;
                if (!selStroke) return;
                const handle = mouseDragHandleRef.current;

                if (handle === 'body') {
                  // Move
                  selStroke.translate.x = mouseDragInitTranslateRef.current.x + (sx - mouseDragStartRef.current.x);
                  selStroke.translate.y = mouseDragInitTranslateRef.current.y + (sy - mouseDragStartRef.current.y);
                  invalidateCache();
                } else if (handle === 'rotate') {
                  // Rotate based on angle from stroke center
                  const box = mouseSelectionBoxRef.current;
                  if (box) {
                    const bCx = (box.minX + box.maxX) / 2;
                    const bCy = (box.minY + box.maxY) / 2;
                    const startAngle = Math.atan2(mouseDragStartRef.current.y - bCy, mouseDragStartRef.current.x - bCx);
                    const curAngle = Math.atan2(sy - bCy, sx - bCx);
                    const deltaAngle = (curAngle - startAngle) * (180 / Math.PI);
                    selStroke.rotation = mouseDragInitRotationRef.current + deltaAngle;
                    invalidateCache();
                  }
                } else if (handle === 'nw' || handle === 'ne' || handle === 'sw' || handle === 'se') {
                  // Scale based on diagonal drag distance
                  const box = mouseSelectionBoxRef.current;
                  if (box) {
                    const bCx = (box.minX + box.maxX) / 2;
                    const bCy = (box.minY + box.maxY) / 2;
                    const initDist = Math.hypot(mouseDragStartRef.current.x - bCx, mouseDragStartRef.current.y - bCy);
                    const curDist = Math.hypot(sx - bCx, sy - bCy);
                    if (initDist > 5) {
                      const scaleFactor = curDist / initDist;
                      selStroke.scale = Math.max(0.05, Math.min(12, mouseDragInitScaleRef.current * scaleFactor));
                      invalidateCache();
                    }
                  }
                }
                return;
              }
              // ── Mouse draw ──
              if (!mouseDrawingRef.current || inputModeRef.current !== 'mouse') return;
              const rect = e.currentTarget.getBoundingClientRect();
              const sx = e.clientX - rect.left;
              const sy = e.clientY - rect.top;
              const stroke = strokeIndexRef.current.get(mouseStrokeIdRef.current ?? '');
              if (!stroke) return;
              const prevPt = stroke.points[stroke.points.length - 1];
              if (Math.hypot(prevPt.x - sx, prevPt.y - sy) > 1.5) {
                stroke.points.push({ x: sx, y: sy });
                const b = stroke.bounds;
                if (sx < b.minX) b.minX = sx;
                if (sy < b.minY) b.minY = sy;
                if (sx > b.maxX) b.maxX = sx;
                if (sy > b.maxY) b.maxY = sy;
              }
            }}
            onPointerUp={() => {
              // ── Select mode end drag ──
              if (inputModeRef.current === 'select' && mouseDragActiveRef.current) {
                mouseDragActiveRef.current = false;
                setDragHandle(null);
                invalidateCache();
                return;
              }
              // ── Mouse draw finalize ──
              if (mouseDrawingRef.current && inputModeRef.current === 'mouse') {
                const stroke = strokeIndexRef.current.get(mouseStrokeIdRef.current ?? '');
                if (stroke) {
                  // Consistent point decimation for mouse drawing
                  if (stroke.points.length > 20) {
                    stroke.points = decimatePoints(stroke.points, 1.0);
                  }
                  stroke.centroid = computeCentroid(stroke.points);
                  stroke.bounds = computeBounds(stroke.points);
                }
                mouseDrawingRef.current = false;
                invalidateCache();
                syncLayersState();
              }
            }}
          />
        </div>

        {/* Text Input Overlay */}
        {showTextInput && (
          <div
            className="absolute z-40"
            style={{ left: textInputPos.x, top: textInputPos.y }}
          >
            <input
              ref={textInputRef}
              type="text"
              placeholder="Type text…"
              autoFocus
              className="bg-black/80 border border-primary/60 text-primary px-4 py-2 text-lg font-space-grotesk outline-none shadow-[0_0_30px_rgba(143,245,255,0.2)] min-w-[200px]"
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur(); // trigger onBlur to commit
                } else if (e.key === 'Escape') {
                  e.currentTarget.value = ''; // clear so blur doesn't commit
                  e.currentTarget.blur();
                }
              }}
              onBlur={(e) => {
                const text = e.currentTarget.value.trim();
                if (text) {
                  const activeLayer = layersRef.current.find((l: Layer) => l.id === activeLayerIdRef.current)
                    ?? layersRef.current[layersRef.current.length - 1];
                  if (!activeLayer.locked) {
                    const pts = textToPoints(text, textInputPos.x, textInputPos.y, 48);
                    if (pts.length > 0) {
                      const newStroke: Stroke = {
                        id: `text-${Date.now()}`,
                        points: pts,
                        color: brushColorRef.current,
                        thickness: 2,
                        scale: 1, rotation: 0, translate: { x: 0, y: 0 },
                        centroid: computeCentroid(pts),
                        bounds: computeBounds(pts),
                        birthTime: performance.now(),
                      };
                      activeLayer.strokes.push(newStroke);
                      strokeIndexRef.current.set(newStroke.id, newStroke);
                      activeStrokeIdRef.current = newStroke.id;
                      invalidateCache();
                      syncLayersState();
                      showToast(`Text "${text}" placed on canvas`);
                    }
                  }
                }
                setShowTextInput(false);
              }}
            />
          </div>
        )}

        {/* Global Status Bar */}
        <div className="absolute bottom-8 left-8 flex items-center gap-6 z-20">
          <div className="glass-panel px-4 py-2 flex items-center gap-4">
            <div className="flex flex-col">
              <span className="text-[9px] font-label text-on-surface-variant uppercase">Vector Engine</span>
              <span className="text-xs font-bold text-primary">{isReady ? 'STABLE' : 'INITIATING...'}</span>
            </div>
            <div className="w-px h-6 bg-outline-variant/20"></div>
            <div className="flex flex-col">
              <span className="text-[9px] font-label text-on-surface-variant uppercase">Latency</span>
              <span className="text-xs font-bold text-on-surface">{latency}ms</span>
            </div>
          </div>
          <div className="flex items-center gap-2 text-on-surface-variant">
            <span className="material-symbols-outlined text-sm">mouse</span>
            <span ref={modeRef} className="text-[10px] font-label uppercase tracking-widest">Wait Mode</span>
          </div>
        </div>

        {/* Tool Palette */}
        <div className="absolute right-8 top-24 flex flex-col gap-2 z-20">
          <button onClick={() => { globalTransformRef.current.scale *= 1.2; invalidateRenderCache(); showToast('Zoom in applied'); }} className="w-12 h-12 glass-panel flex items-center justify-center text-primary border-primary/40 hover:bg-primary/20 transition-all active:bg-primary/40">
            <span className="material-symbols-outlined">zoom_in</span>
          </button>
          <button onClick={() => { globalTransformRef.current.scale = Math.max(0.1, globalTransformRef.current.scale / 1.2); invalidateRenderCache(); showToast('Zoom out applied'); }} className="w-12 h-12 glass-panel flex items-center justify-center text-primary border-primary/40 hover:bg-primary/20 transition-all active:bg-primary/40">
            <span className="material-symbols-outlined">zoom_out</span>
          </button>
          <button onClick={() => { globalTransformRef.current.rotation += 90; invalidateRenderCache(); showToast('Rotated 90 degrees'); }} className="w-12 h-12 glass-panel flex items-center justify-center text-on-surface-variant hover:text-white transition-all active:bg-white/10">
            <span className="material-symbols-outlined">rotate_right</span>
          </button>
          <button onClick={() => { globalTransformRef.current.rotation = 0; globalTransformRef.current.scale = 1; invalidateRenderCache(); showToast('Alignment straight'); }} className="w-12 h-12 glass-panel flex items-center justify-center text-on-surface-variant hover:text-white transition-all active:bg-white/10">
            <span className="material-symbols-outlined">straighten</span>
          </button>
          <div className="h-4"></div>
          <button onClick={() => {
            selectAllModeRef.current = !selectAllModeRef.current;
            setSelectAllModeState(selectAllModeRef.current);
            invalidateCache();
            showToast(selectAllModeRef.current ? 'Selected all strokes' : 'Deselected all strokes');
          }} className={`w-12 h-12 glass-panel flex items-center justify-center transition-all group ${selectAllModeState ? 'text-primary border-primary/40 shadow-[0_0_15px_rgba(143,245,255,0.4)]' : 'text-on-surface-variant border-white/10'}`}>
            <span className="material-symbols-outlined group-active:scale-90 transition-transform">select_all</span>
          </button>
          <button onClick={() => {
            // Delete all strokes in ALL layers, keeping layers themselves
            layersRef.current.forEach(l => { l.strokes = []; });
            activeStrokeIdRef.current = null;
            rightWasPointing.current = false;
            pendingBakesRef.current.clear();
            liveManipulationIdsRef.current.clear();
            invalidateCache();
            syncLayersState(); // reflect cleared stroke counts in UI
          }} className="w-12 h-12 glass-panel flex items-center justify-center text-error border-error/20 hover:bg-error/10 transition-all active:bg-error/30">
            <span className="material-symbols-outlined">delete</span>
          </button>
        </div>

        {/* Webcam Setup & HUD */}
        <div className="absolute bottom-8 right-8 w-64 aspect-video glass-panel overflow-hidden border border-white/10 z-20">
          <div className="absolute inset-0 bg-zinc-900/60 z-0 flex items-center justify-center text-white/50 text-xs text-center p-2">
            {!isReady && !error && "Loading AI Models..."}
            {error && <span className="text-red-500 font-bold bg-red-500/10 px-2 py-1 rounded-2xl">{error}</span>}
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover mix-blend-luminosity opacity-40 -scale-x-100"></video>
            <canvas ref={hudCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none object-cover -scale-x-100"></canvas>
          </div>

          <div className="absolute inset-0 z-10 p-3 flex flex-col justify-between pointer-events-none">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 ${error ? 'bg-red-500' : isReady ? 'bg-error' : 'bg-primary'} rounded-full ${error ? '' : 'animate-pulse'}`}></div>
                <span className={`text-[10px] font-label ${error ? 'text-red-500' : 'text-on-surface'} uppercase tracking-widest`}>{error ? 'CAM ERROR' : isReady ? 'Live Feed' : 'Initializing'}</span>
              </div>
            </div>
            {(() => {
              const leftHand = hands.find(h => h.handedness === 'Left');
              const rightHand = hands.find(h => h.handedness === 'Right');
              if (!leftHand && !rightHand) return null;
              return (
                <div className="flex gap-2 opacity-80">
                  {leftHand && (
                    <div className="flex-1 bg-secondary/20 border border-secondary/40 p-1 flex flex-col items-center">
                      <span className="material-symbols-outlined text-secondary text-sm">front_hand</span>
                      <span className="text-[8px] font-label text-secondary uppercase mt-1">Left ({leftHand.gesture})</span>
                    </div>
                  )}
                  {rightHand && (
                    <div className="flex-1 bg-primary/20 border border-primary/40 p-1 flex flex-col items-center">
                      <span className="material-symbols-outlined text-primary text-sm">front_hand</span>
                      <span className="text-[8px] font-label text-primary uppercase mt-1">Right ({rightHand.gesture})</span>
                    </div>
                  )}
                </div>
              );
            })()}
          </div>
          <div className="absolute inset-0 pointer-events-none bg-[linear-gradient(rgba(18,16,16,0)_50%,rgba(0,0,0,0.25)_50%),linear-gradient(90deg,rgba(255,0,0,0.06),rgba(0,255,0,0.02),rgba(0,0,255,0.06))] bg-[length:100%_2px,3px_100%]"></div>
        </div>

        {/* Visual Polish: Corner Accents */}
        <div className="fixed top-20 right-8 pointer-events-none z-10">
          <div className="w-16 h-px bg-gradient-to-r from-transparent via-primary/30 to-transparent"></div>
        </div>
        <div className="fixed bottom-8 left-[90px] pointer-events-none z-10">
          <div className="h-16 w-px bg-gradient-to-b from-transparent via-secondary/30 to-transparent"></div>
        </div>

        {/* Dynamic Modals & Overlays */}
        {activeModal === 'Settings' && (
          <SettingsModal
            activeTheme={activeTheme}
            applyTheme={applyTheme}
            showToast={showToast}
            closeModal={() => setActiveModal(null)}
            trackingConfig={trackingConfig}
            setTrackingConfig={setTrackingConfig}
          />
        )}

        {activeModal === 'History' && (() => {
          const allStrokes = layersRef.current.flatMap((l: Layer) => l.strokes);
          return (
            <div className="absolute top-24 right-28 w-80 glass-panel border border-primary/20 p-6 z-40 shadow-[0_0_40px_rgba(0,0,0,0.5)]">
              <div className="flex justify-between items-center mb-4">
                <h3 className="font-space-grotesk text-sm text-primary uppercase tracking-widest">Activity Log</h3>
                <button onClick={() => setActiveModal(null)} className="text-white/40 hover:text-white transition-colors"><span className="material-symbols-outlined text-sm">close</span></button>
              </div>
              <div className="mb-3 text-[10px] text-white/30 font-mono">
                {layers.length} layer{layers.length !== 1 ? 's' : ''} · {allStrokes.length} stroke{allStrokes.length !== 1 ? 's' : ''} total
              </div>
              <div className="space-y-2 text-xs text-white/60 max-h-80 overflow-y-auto pr-2 custom-scrollbar">
                <div className="p-2 bg-white/5 border-l-2 border-primary">System initialized</div>
                <div className="p-2 bg-white/5 border-l-2 border-primary">MediaPipe hooks connected</div>
                {layersRef.current.map(layer => (
                  <div key={layer.id}>
                    <div className="p-2 bg-white/5 border-l-2 border-secondary/60 text-white/50">
                      {layer.name} — {layer.strokes.length} strokes {!layer.visible ? '(hidden)' : ''}
                    </div>
                    {layer.strokes.map((s, i) => (
                      <div key={s.id} className="ml-3 p-1.5 bg-white/3 border-l border-white/10 text-white/30 text-[10px] font-mono">
                        ↳ stroke #{i + 1} · {s.points.length}pt · {s.color}
                      </div>
                    ))}
                  </div>
                ))}
                {allStrokes.length === 0 && <div className="text-white/20 italic mt-4 text-center">No strokes yet</div>}
              </div>
            </div>
          );
        })()}

        {activeModal === 'Gestures' && (
          <div className="absolute inset-0 bg-black/40 z-50 flex items-center justify-center backdrop-blur-sm">
            <div className="bg-[#FAFAFA] p-8 max-w-4xl w-full relative border border-white/20 rounded-[3rem] shadow-2xl flex flex-col gap-6">
              <button onClick={() => setActiveModal(null)} className="absolute top-8 right-8 text-[#003D6A] hover:opacity-70 transition-colors w-12 h-12 rounded-full border border-dashed border-[#003D6A]/30 flex items-center justify-center"><span className="material-symbols-outlined">close</span></button>
              
              <div>
                <h2 className="text-4xl font-bold font-space-grotesk text-[#003D6A] tracking-tight">Gesture Control Guide</h2>
                <p className="text-sm text-slate-500 mt-2 font-space-grotesk">Aether Synapse Spatial Kit</p>
              </div>

              <div className="grid grid-cols-2 gap-6 h-full mt-4">
                {/* Right Hand Column */}
                <div className="bg-[#EAF8FF] rounded-[2rem] p-6 flex flex-col">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-[#003D6A] rounded-full flex items-center justify-center shadow-md">
                      <span className="material-symbols-outlined text-white text-lg">front_hand</span>
                    </div>
                    <h3 className="text-xl font-bold text-[#003D6A]">Right Hand:<br/>Creation</h3>
                  </div>

                  <div className="grid grid-cols-3 gap-3 flex-1">
                    <div className="bg-[#FAFAFA] rounded-full flex flex-col items-center justify-between p-4 shadow-sm">
                      <div className="flex flex-col items-center text-center">
                        <div className="w-10 h-10 bg-[#34C1FA] rounded-full flex items-center justify-center mb-3 text-white">
                          <span className="material-symbols-outlined text-sm">edit</span>
                        </div>
                        <strong className="text-[#003D6A] text-sm leading-tight">Index<br/>Point</strong>
                        <p className="text-[10px] text-slate-500 mt-2">Draw in 3D space with precision mapping.</p>
                      </div>
                      <span className="bg-[#EAF8FF] text-[#003D6A] text-[9px] font-bold px-3 py-1 rounded-full uppercase mt-4">Draw</span>
                    </div>

                    <div className="bg-[#FAFAFA] rounded-full flex flex-col items-center justify-between p-4 shadow-sm">
                      <div className="flex flex-col items-center text-center">
                        <div className="w-10 h-10 bg-[#FF6B5B] rounded-full flex items-center justify-center mb-3 text-white">
                          <span className="material-symbols-outlined text-sm">swipe</span>
                        </div>
                        <strong className="text-[#003D6A] text-sm leading-tight">Pinch</strong>
                        <p className="text-[10px] text-slate-500 mt-2">Select or erase specific line segments.</p>
                      </div>
                      <span className="bg-[#FDEBEA] text-[#FF3B30] text-[9px] font-bold px-3 py-1 rounded-full uppercase mt-4">Erase</span>
                    </div>

                    <div className="bg-[#FAFAFA] rounded-full flex flex-col items-center justify-between p-4 shadow-sm">
                      <div className="flex flex-col items-center text-center">
                        <div className="w-10 h-10 bg-slate-300 rounded-full flex items-center justify-center mb-3 text-[#003D6A]">
                          <span className="material-symbols-outlined text-sm">back_hand</span>
                        </div>
                        <strong className="text-[#003D6A] text-sm leading-tight">Fist</strong>
                        <p className="text-[10px] text-slate-500 mt-2">Hold for 2 seconds to clear canvas.</p>
                      </div>
                      <span className="bg-slate-100 text-slate-600 text-[9px] font-bold px-3 py-1 rounded-full uppercase mt-4">Clear</span>
                    </div>
                  </div>
                </div>

                {/* Left Hand Column */}
                <div className="bg-[#FDEBEA] rounded-[2rem] p-6 flex flex-col">
                  <div className="flex items-center gap-3 mb-6">
                    <div className="w-10 h-10 bg-[#FF3B30] rounded-full flex items-center justify-center shadow-md">
                      <span className="material-symbols-outlined text-white text-lg">front_hand</span>
                    </div>
                    <h3 className="text-xl font-bold text-[#003D6A]">Left Hand:<br/>Spatial</h3>
                  </div>

                  <div className="flex flex-col gap-3 flex-1">
                    <div className="bg-[#FAFAFA] rounded-3xl p-4 flex items-center gap-4 shadow-sm relative overflow-hidden">
                      <div className="w-12 h-12 bg-[#EAF8FF] rounded-2xl flex items-center justify-center text-[#34C1FA] shrink-0">
                        <span className="material-symbols-outlined">pinch</span>
                      </div>
                      <div>
                        <strong className="text-[#003D6A] block text-sm">Peace Sign</strong>
                        <p className="text-[11px] text-slate-500 leading-tight mt-1">Move selected layers in XYZ space.</p>
                      </div>
                      <span className="absolute right-4 text-[9px] font-bold text-[#003D6A] tracking-widest uppercase rotate-90 origin-right">Move</span>
                    </div>

                    <div className="bg-[#FAFAFA] rounded-3xl p-4 flex items-center gap-4 shadow-sm relative overflow-hidden">
                      <div className="w-12 h-12 bg-[#FDEBEA] rounded-2xl flex items-center justify-center text-[#FF3B30] shrink-0">
                        <span className="material-symbols-outlined">zoom_out_map</span>
                      </div>
                      <div>
                        <strong className="text-[#003D6A] block text-sm">Pinch & Spread</strong>
                        <p className="text-[11px] text-slate-500 leading-tight mt-1">Uniformly scale objects or canvas.</p>
                      </div>
                      <span className="absolute right-4 text-[9px] font-bold text-[#FF3B30] tracking-widest uppercase rotate-90 origin-right">Scale</span>
                    </div>

                    <div className="bg-[#FAFAFA] rounded-3xl p-4 flex items-center gap-4 shadow-sm relative overflow-hidden">
                      <div className="w-12 h-12 bg-[#EAF8FF] rounded-2xl flex items-center justify-center text-[#34C1FA] shrink-0">
                        <span className="material-symbols-outlined">screen_rotation</span>
                      </div>
                      <div>
                        <strong className="text-[#003D6A] block text-sm">Open Palm</strong>
                        <p className="text-[11px] text-slate-500 leading-tight mt-1">Rotate objects around center axis.</p>
                      </div>
                      <span className="absolute right-4 text-[9px] font-bold text-[#34C1FA] tracking-widest uppercase rotate-90 origin-right">Rotate</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Footer */}
              <div className="flex items-center justify-between col-span-2 pt-2">
                <div className="flex items-center gap-2 text-slate-500 text-sm">
                  <span className="material-symbols-outlined text-[#FF3B30]">info</span>
                  Pro Tip: Combine Left Hand Rotate with Right Hand Draw for helical structures.
                </div>
                <div className="flex gap-4">
                  <button className="px-6 py-3 bg-slate-100 text-[#003D6A] rounded-full font-bold text-sm hover:bg-slate-200 transition-colors">Watch Video</button>
                  <button onClick={() => setActiveModal(null)} className="px-8 py-3 bg-[#34C1FA] text-white rounded-full font-bold text-sm shadow-[0_0_20px_rgba(52,193,250,0.4)] border border-dashed border-white/50 hover:bg-[#20AEEB] transition-colors">I'm Ready</button>
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Sidebar Dynamic Panels */}
        {activeSidebarPanel === 'Brushes' && (
          <div className="absolute left-24 top-1/3 -translate-y-1/2 glass-panel p-5 z-40 flex flex-col gap-4 border border-primary/20 slide-in-from-left animate-in duration-300">
            <h3 className="text-[10px] uppercase tracking-widest font-space-grotesk text-primary opacity-60 mb-1 border-b border-white/5 pb-2">Color Palette</h3>
            <div className="grid grid-cols-2 gap-3">
              {['#003D6A', '#FF3B30', '#FF9F0A', '#30D158', '#34C1FA', '#5E5CE6', '#FF6B5B', '#1C1C1E'].map(c => (
                <button key={c} onClick={() => { brushColorRef.current = c; setBrushColorState(c); setActiveSidebarPanel(null); showToast('Active color updated'); }} className={`w-10 h-10 rounded-full border-2 transition-transform hover:scale-110 ${brushColorState === c ? 'border-primary scale-110 shadow-[0_0_15px_rgba(143,245,255,0.4)]' : 'border-white/20'}`} style={{ backgroundColor: c }}></button>
              ))}
            </div>
          </div>
        )}

        {activeSidebarPanel === 'Depth' && (
          <DepthPanel brushThicknessRef={brushThicknessRef} />
        )}

        {/* Top Tab Content Sections */}
        {activeTab === 'Layers' && (
          <div className="absolute left-28 top-20 bottom-8 w-80 glass-panel z-30 border border-primary/10 shadow-[0_40px_80px_rgba(0,0,0,0.6)] fade-in animate-in flex flex-col">
            {/* Header */}
            <div className="px-5 py-4 border-b border-white/5 flex items-center justify-between">
              <h3 className="text-xs uppercase font-space-grotesk text-white/70 tracking-widest">Layers</h3>
              <button
                onClick={addLayer}
                className="flex items-center gap-1 text-[10px] text-primary border border-primary/30 px-3 py-1 hover:bg-primary/10 transition-colors uppercase font-space-grotesk tracking-wider"
              >
                <span className="material-symbols-outlined text-sm">add</span>New
              </button>
            </div>

            {/* Layer list — bottom layer first in UI = last in render (painter's order) */}
            <div className="flex-1 overflow-y-auto py-3 px-3 space-y-2 custom-scrollbar">
              {[...layers].reverse().map((layer) => {
                const isActive = layer.id === activeLayerIdRef.current;
                const strokeCount = layer.strokes.length;
                return (
                  <div
                    key={layer.id}
                    onClick={() => { activeLayerIdRef.current = layer.id; syncLayersState(); }}
                    className={`group relative flex items-center gap-3 px-4 py-3 rounded-2xl cursor-pointer transition-all border ${isActive
                        ? 'bg-primary/10 border-primary/40 shadow-[0_0_12px_rgba(143,245,255,0.12)]'
                        : 'bg-white/3 border-white/8 hover:border-white/20 hover:bg-white/5'
                      }`}
                  >
                    {/* Active indicator bar */}
                    {isActive && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-4 bg-primary rounded-r" />}

                    {/* Eye icon - visibility toggle */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleLayerVisibility(layer.id); }}
                      className="text-white/40 hover:text-white transition-colors shrink-0"
                      title={layer.visible ? 'Hide layer' : 'Show layer'}
                    >
                      <span className="material-symbols-outlined text-base">
                        {layer.visible ? 'visibility' : 'visibility_off'}
                      </span>
                    </button>

                    {/* Lock icon - lock toggle */}
                    <button
                      onClick={(e) => { e.stopPropagation(); toggleLayerLock(layer.id); }}
                      className={`${layer.locked ? 'text-primary/70' : 'text-white/40'} hover:text-primary transition-colors shrink-0`}
                      title={layer.locked ? 'Unlock layer' : 'Lock layer'}
                    >
                      <span className="material-symbols-outlined text-base">
                        {layer.locked ? 'lock' : 'lock_open'}
                      </span>
                    </button>

                    {/* Layer name — click to rename */}
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => renameLayer(layer.id, e.currentTarget.textContent ?? layer.name)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
                      onClick={(e) => e.stopPropagation()}
                      className={`flex-1 min-w-0 text-xs font-space-grotesk truncate outline-none rounded-md px-1 py-0.5 focus:bg-white/10 ${isActive ? 'text-primary' : layer.visible ? 'text-white/80' : 'text-white/30 line-through'
                        }`}
                    >
                      {layer.name}
                    </span>

                    {/* Stroke count badge */}
                    <span className="text-[10px] text-white/30 font-mono shrink-0">{strokeCount}</span>

                    {/* Delete button */}
                    <button
                      onClick={(e) => { e.stopPropagation(); deleteLayer(layer.id); }}
                      className="text-white/20 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                      title="Delete layer"
                    >
                      <span className="material-symbols-outlined text-sm">delete</span>
                    </button>
                  </div>
                );
              })}
            </div>

            {/* Footer: active layer info */}
            <div className="px-5 py-3 border-t border-white/5 text-[10px] text-white/30 font-mono tracking-wider">
              ACTIVE: {layers.find(l => l.id === activeLayerIdRef.current)?.name ?? '—'}
              &nbsp;·&nbsp;{layers.filter(l => l.visible).length}/{layers.length} visible
            </div>
          </div>
        )}

        {activeTab === 'Assets' && (
          <div className="absolute left-28 right-12 top-28 bottom-8 glass-panel p-8 z-30 border border-primary/10 fade-in animate-in overflow-y-auto custom-scrollbar flex flex-col">
            <div className="flex justify-between items-center border-b border-primary/20 pb-4 mb-6">
              <div>
                <h3 className="text-xs uppercase font-space-grotesk text-white/70 tracking-widest">Asset Library</h3>
                <p className="text-[10px] text-white/30 mt-1">Click any shape node to embed it into the active layer</p>
              </div>
            </div>
            <div className="grid grid-cols-5 gap-4 flex-1">
              {[
                { icon: 'pentagon', label: 'POLY_101' },
                { icon: 'star', label: 'STAR_102' },
                { icon: 'hexagon', label: 'HEX_103' },
                { icon: 'circle', label: 'CIRCLE_104' },
                { icon: 'square', label: 'SQR_105' },
                { icon: 'change_history', label: 'TRI_106' },
                { icon: 'diamond', label: 'DIAM_107' },
                { icon: 'crop_square', label: 'FRAME_108' },
                { icon: 'scatter_plot', label: 'SCATTER_109' },
                { icon: 'architecture', label: 'ARCH_110' },
              ].map(({ icon, label }) => (
                <div
                  key={label}
                  className="aspect-square bg-white/5 border border-white/10 rounded-full flex flex-col items-center justify-center hover:border-primary/50 hover:bg-primary/5 hover:-translate-y-1 transition-all cursor-pointer group"
                  onClick={() => {
                    const activeLayer = layersRef.current.find((l: Layer) => l.id === activeLayerIdRef.current)
                      ?? layersRef.current[layersRef.current.length - 1];
                    if (activeLayer.locked) { showToast('Active layer is locked'); return; }
                    const canvas = drawingCanvasRef.current;
                    const cx = canvas ? canvas.width / 2 : 500;
                    const cy = canvas ? canvas.height / 2 : 400;
                    const pts = generateShapePoints(icon, cx, cy, 80);
                    if (pts.length === 0) return;
                    const newStroke: Stroke = {
                      id: `asset-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                      points: pts,
                      color: brushColorRef.current,
                      thickness: brushThicknessRef.current,
                      scale: 1, rotation: 0, translate: { x: 0, y: 0 },
                      centroid: computeCentroid(pts),
                      bounds: computeBounds(pts),
                      birthTime: performance.now(),
                    };
                    activeLayer.strokes.push(newStroke);
                    strokeIndexRef.current.set(newStroke.id, newStroke);
                    activeStrokeIdRef.current = newStroke.id;
                    invalidateCache();
                    syncLayersState();
                    showToast(`${label} embedded into active layer`);
                  }}
                >
                  <span className="material-symbols-outlined text-5xl text-white/20 mb-3 group-hover:text-primary transition-colors">{icon}</span>
                  <span className="text-[10px] text-white/40 tracking-wider font-mono group-hover:text-white/70 transition-colors">{label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
