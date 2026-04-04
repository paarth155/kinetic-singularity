import { useRef, useEffect, useState, useCallback } from 'react';
import { useHandTracking } from './useHandTracking';

type Vector2 = { x: number; y: number };

type Stroke = {
  id: string;
  points: Vector2[];
  color: string;
  thickness: number;
  scale: number;
  rotation: number;
  translate: Vector2;
};

type Layer = {
  id: string;
  name: string;
  visible: boolean;
  locked: boolean;
  strokes: Stroke[];
};

const DEFAULT_LAYER: Layer = { id: 'layer-1', name: 'Layer 1', visible: true, locked: false, strokes: [] };

export default function App() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const hudCanvasRef = useRef<HTMLCanvasElement>(null);
  const drawingCanvasRef = useRef<HTMLCanvasElement>(null);
  
  const { hands, handsRef, isReady, latency } = useHandTracking(videoRef, hudCanvasRef);
  
  // ─── Layer system ───────────────────────────────────────────────────────────
  // layersRef is the mutable source-of-truth used in the RAF loop.
  // layers state is synced only when structure changes (add/delete/rename/visibility)
  // so the UI re-renders without touching the hot render path.
  const layersRef = useRef<Layer[]>([{ ...DEFAULT_LAYER, strokes: [] }]);
  const [layers, setLayers] = useState<Layer[]>(layersRef.current);
  const activeLayerIdRef = useRef<string>('layer-1');

  const syncLayersState = () => setLayers(layersRef.current.map(l => ({ ...l, strokes: l.strokes })));

  const addLayer = () => {
    const id = `layer-${Date.now()}`;
    const name = `Layer ${layersRef.current.length + 1}`;
    const newLayer: Layer = { id, name, visible: true, locked: false, strokes: [] };
    layersRef.current = [...layersRef.current, newLayer];
    activeLayerIdRef.current = id;
    syncLayersState();
  };

  const deleteLayer = (id: string) => {
    if (layersRef.current.length === 1) { showToast('Cannot delete the last layer'); return; }
    layersRef.current = layersRef.current.filter(l => l.id !== id);
    // If active was deleted, pick the last remaining layer
    if (activeLayerIdRef.current === id) {
      activeLayerIdRef.current = layersRef.current[layersRef.current.length - 1].id;
    }
    syncLayersState();
  };

  const toggleLayerVisibility = (id: string) => {
    const layer = layersRef.current.find(l => l.id === id);
    if (layer) { layer.visible = !layer.visible; syncLayersState(); }
  };

  const renameLayer = (id: string, name: string) => {
    const layer = layersRef.current.find(l => l.id === id);
    if (layer) { layer.name = name; syncLayersState(); }
  };
  // ─────────────────────────────────────────────────────────────────────────

  const activeStrokeIdRef = useRef<string | null>(null);
  const modeRef = useRef<HTMLSpanElement>(null);
  
  const brushColorRef = useRef<string>('#8ff5ff');
  const brushThicknessRef = useRef<number>(6);
  const globalTransformRef = useRef({ scale: 1, rotation: 0 });
  // Cursor preview: tracks right-hand index tip on the drawing canvas
  const cursorRef = useRef<{ x: number; y: number; visible: boolean; drawing: boolean; selecting: boolean }>({
    x: 0, y: 0, visible: false, drawing: false, selecting: false
  });
  // Hovered / selected-via-proximity stroke
  const hoveredStrokeIdRef = useRef<string | null>(null);

  const [activeTab, setActiveTab] = useState<string>('Draw');
  const [activeModal, setActiveModal] = useState<string | null>(null);
  const [activeSidebarPanel, setActiveSidebarPanel] = useState<string | null>(null);

  // ─── Theme ───────────────────────────────────────────────────────────────────
  type ThemeId = 'holo-blue' | 'crimson';
  const [activeTheme, setActiveTheme] = useState<ThemeId>('holo-blue');
  const applyTheme = useCallback((theme: ThemeId) => {
    document.documentElement.setAttribute('data-theme', theme);
    setActiveTheme(theme);
    // Swap brush cursor default color to match theme accent
    if (theme === 'crimson') {
      brushColorRef.current = brushColorRef.current === '#8ff5ff' ? '#ff4f6d' : brushColorRef.current;
    } else {
      brushColorRef.current = brushColorRef.current === '#ff4f6d' ? '#8ff5ff' : brushColorRef.current;
    }
  }, []);

  // ─── Tracking quality (applied to handsRef smoothing decisions) ──────────────
  // Lower smoothingRef = less EMA smoothing (more responsive), higher = smoother
  const trackingQualityRef = useRef<'high' | 'balanced' | 'economy'>('balanced');

  const [toastMessage, setToastMessage] = useState<string | null>(null);

  const showToast = (msg: string) => {
    setToastMessage(msg);
    // Auto-clear toast
    setTimeout(() => setToastMessage(null), 3000);
  };
  
  // Manipulation state
  const leftHandState = useRef({
    initialPointer: { x: 0, y: 0 },
    initialScale: 1,
    initialRotation: 0,
    initialTranslate: { x: 0, y: 0 },
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

    function processGestures() {
      // Guard: don't process if no hands are being tracked yet and canvas is empty
      if (handsRef.current.length === 0 && layersRef.current.every(l => l.strokes.length === 0)) return;
      const liveHands = handsRef.current;
      const rightHand = liveHands.find(h => h.handedness === 'Right');
      const leftHand  = liveHands.find(h => h.handedness === 'Left');

      let currentMode = 'Idle';
      let newActiveStrokeId = activeStrokeIdRef.current;

      // Flat list of strokes across ALL visible layers (for hover/select search)
      const allVisibleStrokes = layersRef.current.filter(l => l.visible).flatMap(l => l.strokes);

      // Find the active layer (where new strokes are created)
      const activeLayer = layersRef.current.find(l => l.id === activeLayerIdRef.current)
        ?? layersRef.current[layersRef.current.length - 1];

      // Helper: find a stroke across ALL layers by ID
      function findStrokeById(id: string): Stroke | undefined {
        for (const l of layersRef.current) {
          const s = l.strokes.find(s => s.id === id);
          if (s) return s;
        }
        return undefined;
      }

      if (rightHand) {
        const indexTip = rightHand.landmarks[8];
        const screenX = (1 - indexTip.x) * canvas!.width;
        const screenY = indexTip.y * canvas!.height;

        cursorRef.current = {
          x: screenX, y: screenY, visible: true,
          drawing: rightHand.gesture === 'IndexPoint',
          selecting: rightHand.gesture === 'Pinch',
        };

        // Hover detection (idle only) — search visible strokes
        if (rightHand.gesture === 'None') {
          let nearestId: string | null = null;
          let nearestDist = 180;
          for (const s of allVisibleStrokes) {
            if (s.points.length === 0) continue;
            let cx = 0, cy = 0;
            s.points.forEach(p => { cx += p.x; cy += p.y; });
            cx = cx / s.points.length + s.translate.x;
            cy = cy / s.points.length + s.translate.y;
            const d = Math.hypot(cx - screenX, cy - screenY);
            if (d < nearestDist) { nearestDist = d; nearestId = s.id; }
          }
          hoveredStrokeIdRef.current = nearestId;
        } else {
          hoveredStrokeIdRef.current = null;
        }

        if (rightHand.gesture === 'IndexPoint') {
          currentMode = 'Draw';
          if (!activeLayer.locked) {
            if (!rightWasPointing.current) {
              const newStroke: Stroke = {
                id: Date.now().toString(),
                points: [{ x: screenX, y: screenY }],
                color: brushColorRef.current,
                thickness: brushThicknessRef.current,
                scale: 1, rotation: 0, translate: { x: 0, y: 0 }
              };
              activeLayer.strokes.push(newStroke);
              newActiveStrokeId = newStroke.id;
              rightWasPointing.current = true;
            } else {
              // Continue the active stroke, find by id across all layers
              const activeStroke = findStrokeById(newActiveStrokeId ?? '');
              if (activeStroke && activeStroke.points.length > 0) {
                const prevPt = activeStroke.points[activeStroke.points.length - 1];
                if (Math.hypot(prevPt.x - screenX, prevPt.y - screenY) > 1.5) {
                  activeStroke.points.push({ x: screenX, y: screenY });
                }
              }
            }
          }
        } else {
          rightWasPointing.current = false;
        }

        if (rightHand.gesture === 'Fist') {
          currentMode = 'Clear Canvas';
          // Clear only the active layer
          if (activeLayer.strokes.length > 0) {
            activeLayer.strokes = [];
            newActiveStrokeId = null;
          }
        }

        if (rightHand.gesture === 'Pinch') {
          currentMode = 'Select';
          let nearestId: string | null = null;
          let nearestDist = 220;
          for (const s of allVisibleStrokes) {
            if (s.points.length === 0) continue;
            let cx = 0, cy = 0;
            s.points.forEach(p => { cx += p.x; cy += p.y; });
            cx = cx / s.points.length + s.translate.x;
            cy = cy / s.points.length + s.translate.y;
            const d = Math.hypot(cx - screenX, cy - screenY);
            if (d < nearestDist) { nearestDist = d; nearestId = s.id; }
          }
          if (nearestId && nearestId !== newActiveStrokeId) {
            newActiveStrokeId = nearestId;
          }
        }
      } else {
        rightWasPointing.current = false;
        cursorRef.current.visible = false;
      }

      // Left hand manipulation — find target stroke across all layers
      const targetStroke = newActiveStrokeId ? findStrokeById(newActiveStrokeId) : (() => {
        // Fallback: last stroke in active layer
        const al = layersRef.current.find(l => l.id === activeLayerIdRef.current);
        return al?.strokes[al.strokes.length - 1];
      })();

      if (leftHand && targetStroke) {
        const state = leftHandState.current;
        const indexTip = leftHand.landmarks[8];
        const wrist = leftHand.landmarks[0];
        const ptX = (1 - indexTip.x) * canvas!.width;
        const ptY = indexTip.y * canvas!.height;

        if (leftHand.gesture === 'Peace') {
          currentMode = 'Move';
          if (!state.isGrabbing) {
            state.isGrabbing = true;
            state.initialPointer = { x: ptX, y: ptY };
            state.initialTranslate = { ...targetStroke.translate };
          } else {
            targetStroke.translate.x = state.initialTranslate.x + (ptX - state.initialPointer.x);
            targetStroke.translate.y = state.initialTranslate.y + (ptY - state.initialPointer.y);
          }
        } else { state.isGrabbing = false; }

        if (leftHand.gesture === 'Pinch') {
          currentMode = 'Scale';
          const currentX = (1 - indexTip.x) * canvas!.width;
          if (!state.isScaling) {
            state.isScaling = true;
            state.initialPointer = { x: currentX, y: 0 };
            state.initialScale = targetStroke.scale;
          } else {
            const dragDelta = state.initialPointer.x - currentX;
            const scaleFactor = 1 + (dragDelta / 200);
            targetStroke.scale = Math.max(0.05, Math.min(12, state.initialScale * scaleFactor));
          }
        } else { state.isScaling = false; }

        if (leftHand.gesture === 'OpenPalm') {
          currentMode = 'Rotate';
          const mirrorIndexX = 1 - indexTip.x;
          const mirrorWristX = 1 - wrist.x;
          const angle = Math.atan2(indexTip.y - wrist.y, mirrorIndexX - mirrorWristX) * (180 / Math.PI);
          targetStroke.rotation = Math.round(angle / 45) * 45;
        }
      } else if (leftHand) {
        leftHandState.current.isGrabbing = false;
        leftHandState.current.isScaling = false;
        leftHandState.current.isRotating = false;
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

      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      
      const currentActiveId = activeStrokeIdRef.current;
      const t = globalTransformRef.current;
      
      ctx!.save();
      
      // Global View Transform
      const cw = canvas!.width / 2;
      const ch = canvas!.height / 2;
      ctx!.translate(cw, ch);
      ctx!.rotate((t.rotation * Math.PI) / 180);
      ctx!.scale(t.scale, t.scale);
      ctx!.translate(-cw, -ch);
      
      // Render all visible layers bottom-to-top
      layersRef.current.filter(l => l.visible).forEach(layer => {
      layer.strokes.forEach((stroke) => {
        const isSelected = stroke.id === currentActiveId;
        const isHovered = stroke.id === hoveredStrokeIdRef.current && !isSelected;
        
        ctx!.save();
        
        // Calculate bounding box + centroid for transforms
        if (stroke.points.length > 0) {
           let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
           stroke.points.forEach(p => {
             if (p.x < minX) minX = p.x;
             if (p.y < minY) minY = p.y;
             if (p.x > maxX) maxX = p.x;
             if (p.y > maxY) maxY = p.y;
           });
           const cx = minX + (maxX - minX)/2;
           const cy = minY + (maxY - minY)/2;

           ctx!.translate(cx + stroke.translate.x, cy + stroke.translate.y);
           ctx!.rotate((stroke.rotation * Math.PI) / 180);
           ctx!.scale(stroke.scale, stroke.scale);
           ctx!.translate(-cx, -cy);

           // Hover glow: dashed gold outline
           if (isHovered) {
             ctx!.save();
             ctx!.strokeStyle = 'rgba(255, 208, 0, 0.5)';
             ctx!.lineWidth = 1;
             ctx!.setLineDash([5, 4]);
             ctx!.shadowColor = 'rgba(255, 208, 0, 0.4)';
             ctx!.shadowBlur = 14;
             ctx!.strokeRect(minX - 12, minY - 12, (maxX - minX) + 24, (maxY - minY) + 24);
             ctx!.setLineDash([]);
             ctx!.shadowBlur = 0;
             ctx!.restore();
           }

           // Selection box: bright cyan, solid
           if (isSelected) {
             ctx!.save();
             ctx!.strokeStyle = 'rgba(143, 245, 255, 0.85)';
             ctx!.lineWidth = 1.5;
             ctx!.shadowColor = 'rgba(143, 245, 255, 0.5)';
             ctx!.shadowBlur = 24;
             ctx!.strokeRect(minX - 10, minY - 10, (maxX - minX) + 20, (maxY - minY) + 20);
             ctx!.shadowBlur = 0;
             // Corner handle dots
             const corners: [number, number][] = [
               [minX - 10, minY - 10], [maxX + 10, minY - 10],
               [minX - 10, maxY + 10], [maxX + 10, maxY + 10]
             ];
             corners.forEach(([hx, hy]) => {
               ctx!.beginPath();
               ctx!.arc(hx, hy, 4, 0, Math.PI * 2);
               ctx!.fillStyle = 'rgba(143, 245, 255, 0.9)';
               ctx!.shadowColor = '#8ff5ff';
               ctx!.shadowBlur = 8;
               ctx!.fill();
               ctx!.shadowBlur = 0;
             });
             ctx!.restore();
           }
        }

        ctx!.beginPath();
        stroke.points.forEach((p, idx) => {
          if (idx === 0) ctx!.moveTo(p.x, p.y);
          else ctx!.lineTo(p.x, p.y);
        });
        
        ctx!.strokeStyle = stroke.color;
        ctx!.lineWidth = stroke.thickness;
        ctx!.lineCap = 'round';
        ctx!.lineJoin = 'round';
        ctx!.shadowColor = stroke.color;
        ctx!.shadowBlur = 15;
        ctx!.stroke();
        
        ctx!.restore();
      });  // end layer.strokes.forEach
      }); // end layersRef.current.filter.forEach

      ctx!.restore(); // restore global view transform

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

      animId = requestAnimationFrame(render);
    }
    render();

    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <div className="bg-background text-on-surface h-screen w-screen overflow-hidden">
      {/* TopAppBar */}
      <header className="fixed top-0 w-full flex justify-between items-center px-8 h-16 z-50 bg-transparent backdrop-blur-xl border-b border-white/5 shadow-[0_0_50px_rgba(143,245,255,0.08)]">
        {/* Toast Notification */}
        {toastMessage && (
          <div className="fixed top-24 left-1/2 -translate-x-1/2 z-50 bg-black/80 border border-primary/40 backdrop-blur-xl px-6 py-3 text-primary text-sm font-space-grotesk tracking-wider animate-in fade-in slide-in-from-top-4 duration-300 shadow-[0_0_20px_rgba(143,245,255,0.2)]">
            {toastMessage}
          </div>
        )}

        <div className="text-xl font-bold tracking-widest text-primary space-grotesk">KINETIC_SINGULARITY</div>
        <nav className="flex gap-8">
          <a onClick={(e) => { e.preventDefault(); setActiveTab('Draw'); }} className={`cursor-pointer font-space-grotesk tracking-tight text-sm uppercase transition-all duration-300 ${activeTab === 'Draw' ? 'text-primary border-b border-primary pb-1' : 'text-slate-500 hover:text-slate-300'}`} href="#">Draw</a>
          <a onClick={(e) => { e.preventDefault(); setActiveTab('Layers'); }} className={`cursor-pointer font-space-grotesk tracking-tight text-sm uppercase transition-all duration-300 ${activeTab === 'Layers' ? 'text-primary border-b border-primary pb-1' : 'text-slate-500 hover:text-slate-300'}`} href="#">Layers</a>
          <a onClick={(e) => { e.preventDefault(); setActiveTab('Assets'); }} className={`cursor-pointer font-space-grotesk tracking-tight text-sm uppercase transition-all duration-300 ${activeTab === 'Assets' ? 'text-primary border-b border-primary pb-1' : 'text-slate-500 hover:text-slate-300'}`} href="#">Assets</a>
        </nav>
        <div className="flex items-center gap-6">
          <button onClick={() => setActiveModal('Settings')} className={`transition-all ${activeModal === 'Settings' ? 'text-primary' : 'text-slate-500 hover:text-primary'}`}>
            <span className="material-symbols-outlined">settings</span>
          </button>
          <button onClick={() => setActiveModal('History')} className={`transition-all ${activeModal === 'History' ? 'text-primary' : 'text-slate-500 hover:text-primary'}`}>
            <span className="material-symbols-outlined">history</span>
          </button>
          <button onClick={() => { navigator.clipboard.writeText(window.location.href); showToast('Project link copied to clipboard!'); }} className="text-slate-500 hover:text-primary transition-all">
            <span className="material-symbols-outlined">share</span>
          </button>
          <div className="w-8 h-8 bg-surface-container-highest flex items-center justify-center">
            <img alt="User profile" className="w-full h-full object-cover" src="https://lh3.googleusercontent.com/aida-public/AB6AXuBqjJFKVaIMYLouxbZp3BQALG3vfhajeyj8c85awuG_DnoOD9jyO8vSFF8FIu6x83AscnIOURaGEnlj22bGVcXMMXAD0WSrbsiNUHlAePQMp4epReXungnGpDp4SgkPb4za6kjcxA16TdraC92V0QfcjsgR0euz53Cdv7WV3FPuQOFk_IAEx9aF99mx_rybzRqqpFmtgIKgB35pF0Q7c1V-F0mBqlm-I1dTC4F8KaGNUtjtRy-fMtYnSqwmXXkfRDuWH9Kc7cC4tPJy"/>
          </div>
        </div>
      </header>

      {/* SideNavBar */}
      <aside className="fixed left-0 top-0 h-full w-20 bg-zinc-950/40 backdrop-blur-2xl border-r border-white/5 flex flex-col py-20 z-40">
        <div className="flex flex-col items-center mb-10">
          <div className="w-10 h-10 border border-primary/20 flex items-center justify-center mb-2">
            <span className="material-symbols-outlined text-primary text-xl" style={{ fontVariationSettings: "'FILL' 1" }}>deployed_code</span>
          </div>
          <div className="text-cyan-400 font-bold text-[10px] space-grotesk tracking-tighter">SINGULARITY</div>
        </div>
        <nav className="flex-1">
          <div onClick={() => setActiveSidebarPanel(activeSidebarPanel === 'Brushes' ? null : 'Brushes')} className={`py-4 flex flex-col items-center justify-center cursor-pointer transition-colors group ${activeSidebarPanel === 'Brushes' ? 'bg-primary/10 border-l-2 border-primary text-primary' : 'text-slate-600 hover:bg-white/5 hover:text-white'}`}>
            <span className="material-symbols-outlined mb-1">brush</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Brushes</span>
          </div>
          <div onClick={() => setActiveModal('Gestures')} className="text-slate-600 py-4 flex flex-col items-center justify-center hover:bg-white/5 hover:text-white transition-colors cursor-pointer group">
            <span className="material-symbols-outlined mb-1">gesture</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Gestures</span>
          </div>
          <div onClick={() => setActiveSidebarPanel(activeSidebarPanel === 'Depth' ? null : 'Depth')} className={`py-4 flex flex-col items-center justify-center cursor-pointer transition-colors group ${activeSidebarPanel === 'Depth' ? 'bg-primary/10 border-l-2 border-primary text-primary' : 'text-slate-600 hover:bg-white/5 hover:text-white'}`}>
            <span className="material-symbols-outlined mb-1">layers</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Depth</span>
          </div>
          <div onClick={() => {
            if (drawingCanvasRef.current) {
              const url = drawingCanvasRef.current.toDataURL('image/png');
              const a = document.createElement('a');
              a.href = url;
              a.download = 'kinetic-singularity-export.png';
              a.click();
              showToast('Canvas exported as PNG');
            }
          }} className="text-slate-600 py-4 flex flex-col items-center justify-center hover:bg-white/5 hover:text-white transition-colors cursor-pointer group">
            <span className="material-symbols-outlined mb-1">ios_share</span>
            <span className="font-space-grotesk text-[10px] uppercase tracking-tighter">Export</span>
          </div>
        </nav>
        <div className="px-2">
          <button onClick={() => {
            showToast('Recalibrating sensors and clearing canvas...');
            layersRef.current.forEach(l => { l.strokes = []; });
            activeStrokeIdRef.current = null;
            globalTransformRef.current = { scale: 1, rotation: 0 };
            syncLayersState(); // reflect cleared stroke counts in UI
          }} className="w-full py-2 bg-primary/10 border border-primary/30 text-primary text-[10px] font-bold space-grotesk tracking-widest hover:bg-primary hover:text-on-primary active:bg-primary active:text-on-primary transition-all">
              CALIBRATE
          </button>
        </div>
      </aside>

      {/* Main Canvas Area */}
      <main className="ml-20 pt-16 h-screen w-[calc(100%-5rem)] relative overflow-hidden canvas-grid">
        <div className="absolute inset-0 z-0">
          <canvas ref={drawingCanvasRef} id="drawing-canvas" className="w-full h-full" />
        </div>
        
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
          <button onClick={() => { globalTransformRef.current.scale *= 1.2; showToast('Zoom in applied'); }} className="w-12 h-12 glass-panel flex items-center justify-center text-primary border-primary/40 hover:bg-primary/20 transition-all active:bg-primary/40">
            <span className="material-symbols-outlined">zoom_in</span>
          </button>
          <button onClick={() => { globalTransformRef.current.scale = Math.max(0.1, globalTransformRef.current.scale / 1.2); showToast('Zoom out applied'); }} className="w-12 h-12 glass-panel flex items-center justify-center text-primary border-primary/40 hover:bg-primary/20 transition-all active:bg-primary/40">
            <span className="material-symbols-outlined">zoom_out</span>
          </button>
          <button onClick={() => { globalTransformRef.current.rotation += 90; showToast('Rotated 90 degrees'); }} className="w-12 h-12 glass-panel flex items-center justify-center text-on-surface-variant hover:text-white transition-all active:bg-white/10">
            <span className="material-symbols-outlined">rotate_right</span>
          </button>
          <button onClick={() => { globalTransformRef.current.rotation = 0; globalTransformRef.current.scale = 1; showToast('Alignment straight'); }} className="w-12 h-12 glass-panel flex items-center justify-center text-on-surface-variant hover:text-white transition-all active:bg-white/10">
            <span className="material-symbols-outlined">straighten</span>
          </button>
          <div className="h-4"></div>
          <button onClick={() => {
            // Delete all strokes in ALL layers, keeping layers themselves
            layersRef.current.forEach(l => { l.strokes = []; });
            activeStrokeIdRef.current = null;
            syncLayersState(); // reflect cleared stroke counts in UI
          }} className="w-12 h-12 glass-panel flex items-center justify-center text-error border-error/20 hover:bg-error/10 transition-all active:bg-error/30">
            <span className="material-symbols-outlined">delete</span>
          </button>
        </div>

        {/* Webcam Setup & HUD */}
        <div className="absolute bottom-8 right-8 w-64 aspect-video glass-panel overflow-hidden border border-white/10 z-20">
          <div className="absolute inset-0 bg-zinc-900/60 z-0 flex items-center justify-center text-white/50 text-xs text-center p-2">
            {!isReady && "Loading AI Models..."}
            <video ref={videoRef} autoPlay playsInline muted className="absolute inset-0 w-full h-full object-cover mix-blend-luminosity opacity-40 -scale-x-100"></video>
            <canvas ref={hudCanvasRef} className="absolute inset-0 w-full h-full pointer-events-none object-cover -scale-x-100"></canvas>
          </div>
          
          <div className="absolute inset-0 z-10 p-3 flex flex-col justify-between pointer-events-none">
            <div className="flex justify-between items-start">
              <div className="flex items-center gap-2">
                <div className={`w-2 h-2 ${isReady ? 'bg-error' : 'bg-primary'} rounded-full animate-pulse`}></div>
                <span className="text-[10px] font-label text-on-surface uppercase tracking-widest">{isReady ? 'Live Feed' : 'Initializing'}</span>
              </div>
            </div>
            {(hands.length > 0) && (
              <div className="flex gap-2 opacity-80">
                {hands.find(h => h.handedness === 'Left') && (
                  <div className="flex-1 bg-secondary/20 border border-secondary/40 p-1 flex flex-col items-center">
                    <span className="material-symbols-outlined text-secondary text-sm">front_hand</span>
                    <span className="text-[8px] font-label text-secondary uppercase mt-1">Left ({hands.find(h => h.handedness === 'Left')?.gesture})</span>
                  </div>
                )}
                {hands.find(h => h.handedness === 'Right') && (
                  <div className="flex-1 bg-primary/20 border border-primary/40 p-1 flex flex-col items-center">
                    <span className="material-symbols-outlined text-primary text-sm">front_hand</span>
                    <span className="text-[8px] font-label text-primary uppercase mt-1">Right ({hands.find(h => h.handedness === 'Right')?.gesture})</span>
                  </div>
                )}
              </div>
            )}
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
        {activeModal === 'Settings' && (() => {
          // Local draft state so changes only apply on "Apply"
          let draftQuality = trackingQualityRef.current;
          let draftTheme: ThemeId = activeTheme;
          let draftSmoothing = 50;
          return (
            <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm">
               <div className="glass-panel p-8 max-w-md w-full relative border border-primary/20 shadow-[0_0_80px_rgba(143,245,255,0.1)]">
                 <button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors"><span className="material-symbols-outlined">close</span></button>
                 <h2 className="text-xl font-space-grotesk text-primary mb-6 tracking-widest uppercase">System Settings</h2>
                 <div className="space-y-4 text-sm text-white/70">
                   <div className="flex justify-between items-center bg-white/5 p-4 rounded border border-white/5">
                      <div>
                        <label className="font-space-grotesk tracking-wide text-xs uppercase block">Tracking Engine</label>
                        <span className="text-[10px] text-white/30">Hand detection performance mode</span>
                      </div>
                      <select
                        defaultValue={trackingQualityRef.current}
                        onChange={(e) => { draftQuality = e.target.value as typeof draftQuality; }}
                        className="bg-zinc-900 text-primary outline-none border border-primary/30 rounded px-2 py-1 text-xs"
                      >
                        <option value="high">High Perf</option>
                        <option value="balanced">Balanced</option>
                        <option value="economy">Economy</option>
                      </select>
                   </div>
                   <div className="flex justify-between items-center bg-white/5 p-4 rounded border border-white/5">
                      <div>
                        <label className="font-space-grotesk tracking-wide text-xs uppercase block">Hand Smoothing</label>
                        <span className="text-[10px] text-white/30">EMA filter strength (higher = smoother)</span>
                      </div>
                      <div className="flex items-center gap-2 w-1/2">
                        <input
                          id="smoothing-range"
                          type="range" min="0" max="100" defaultValue="50"
                          className="flex-1 accent-primary"
                          onChange={(e) => { draftSmoothing = parseInt(e.target.value); }}
                        />
                        <span id="smoothing-val" className="text-[10px] text-white/40 w-6">50</span>
                      </div>
                   </div>
                   <div className="flex justify-between items-center bg-white/5 p-4 rounded border border-white/5">
                      <div>
                        <label className="font-space-grotesk tracking-wide text-xs uppercase block">UI Theme</label>
                        <span className="text-[10px] text-white/30">Color accent for the interface</span>
                      </div>
                      <select
                        defaultValue={activeTheme}
                        onChange={(e) => { draftTheme = e.target.value as ThemeId; }}
                        className="bg-zinc-900 text-primary outline-none border border-primary/30 rounded px-2 py-1 text-xs"
                      >
                        <option value="holo-blue">Holo Blue</option>
                        <option value="crimson">Crimson</option>
                      </select>
                   </div>
                 </div>
                 <button
                   onClick={() => {
                     trackingQualityRef.current = draftQuality;
                     applyTheme(draftTheme);
                     // Update smoothing slider label
                     const el = document.getElementById('smoothing-val');
                     if (el) el.textContent = String(draftSmoothing);
                     showToast('Settings applied successfully.');
                     setActiveModal(null);
                   }}
                   className="mt-8 w-full bg-primary/20 hover:bg-primary text-primary hover:text-background border border-primary font-space-grotesk tracking-widest text-xs py-3 transition-colors uppercase"
                 >
                   Apply Changes
                 </button>
               </div>
            </div>
          );
        })()}
        
        {activeModal === 'History' && (() => {
          const allStrokes = layersRef.current.flatMap(l => l.strokes);
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
          <div className="absolute inset-0 bg-black/60 z-50 flex items-center justify-center backdrop-blur-sm">
             <div className="glass-panel p-8 max-w-2xl w-full relative border border-primary/20">
               <button onClick={() => setActiveModal(null)} className="absolute top-6 right-6 text-white/50 hover:text-white transition-colors"><span className="material-symbols-outlined">close</span></button>
               <h2 className="text-2xl font-space-grotesk text-primary mb-8 tracking-widest uppercase">Gesture Mapping Guide</h2>
               <div className="grid grid-cols-2 gap-6 text-sm">
                 <div className="p-5 bg-white/5 rounded border border-white/5 hover:border-primary/30 transition-colors">
                    <strong className="text-primary block mb-2 font-space-grotesk uppercase text-xs tracking-wider">Right Index Point</strong>
                    <span className="text-white/60">Draw continuous strokes on canvas</span>
                 </div>
                 <div className="p-5 bg-white/5 rounded border border-white/5 hover:border-primary/30 transition-colors">
                    <strong className="text-secondary block mb-2 font-space-grotesk uppercase text-xs tracking-wider">Right Fist</strong>
                    <span className="text-white/60">Flash clear the entire canvas immediately</span>
                 </div>
                 <div className="p-5 bg-white/5 rounded border border-white/5 hover:border-primary/30 transition-colors">
                    <strong className="text-primary block mb-2 font-space-grotesk uppercase text-xs tracking-wider">Right Pinch</strong>
                    <span className="text-white/60">Select nearest stroke for manipulation</span>
                 </div>
                 <div className="p-5 bg-white/5 rounded border border-white/5 hover:border-primary/30 transition-colors">
                    <strong className="text-primary block mb-2 font-space-grotesk uppercase text-xs tracking-wider">Left Peace Sign</strong>
                    <span className="text-white/60">Grab and move active stroke globally</span>
                 </div>
                 <div className="p-5 bg-white/5 rounded border border-white/5 hover:border-secondary/30 transition-colors">
                    <strong className="text-secondary block mb-2 font-space-grotesk uppercase text-xs tracking-wider">Left Pinch</strong>
                    <span className="text-white/60">Scale object size using thumb/index spread</span>
                 </div>
                 <div className="p-5 bg-white/5 rounded border border-white/5 hover:border-primary/30 transition-colors">
                    <strong className="text-primary block mb-2 font-space-grotesk uppercase text-xs tracking-wider">Left Open Palm</strong>
                    <span className="text-white/60">Snap-rotate active stroke based on wrist angle</span>
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
                {['#8ff5ff', '#ff51fa', '#51ff56', '#ff5151', '#fff', '#000', '#ffd000', '#9c51ff'].map(c => (
                  <button key={c} onClick={() => { brushColorRef.current = c; setActiveSidebarPanel(null); showToast('Active color updated'); }} className={`w-10 h-10 rounded-full border-2 transition-transform hover:scale-110 ${brushColorRef.current === c ? 'border-primary scale-110 shadow-[0_0_15px_rgba(143,245,255,0.4)]' : 'border-white/20'}`} style={{ backgroundColor: c }}></button>
                ))}
             </div>
          </div>
        )}

        {activeSidebarPanel === 'Depth' && (
          <div className="absolute left-24 top-1/2 -translate-y-1/2 glass-panel p-5 z-40 w-56 border border-primary/20 slide-in-from-left animate-in duration-300">
             <div className="flex justify-between items-center border-b border-white/5 pb-3 mb-4">
                 <h3 className="text-[10px] uppercase tracking-widest font-space-grotesk text-primary opacity-60">Stroke Thickness</h3>
                 <span className="text-xs text-white/50">{brushThicknessRef.current}px</span>
             </div>
             <input type="range" min="1" max="30" defaultValue={brushThicknessRef.current} className="w-full h-1 bg-white/20 rounded outline-none appearance-none accent-primary" 
              onChange={(e) => { 
                brushThicknessRef.current = parseInt(e.target.value); 
                e.target.previousElementSibling!.lastElementChild!.textContent = `${e.target.value}px`; 
              }} 
             />
          </div>
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
                    className={`group relative flex items-center gap-3 px-4 py-3 rounded cursor-pointer transition-all border ${
                      isActive
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

                    {/* Layer name — click to rename */}
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => renameLayer(layer.id, e.currentTarget.textContent ?? layer.name)}
                      onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); (e.currentTarget as HTMLElement).blur(); } }}
                      onClick={(e) => e.stopPropagation()}
                      className={`flex-1 min-w-0 text-xs font-space-grotesk truncate outline-none rounded px-1 py-0.5 focus:bg-white/10 ${
                        isActive ? 'text-primary' : layer.visible ? 'text-white/80' : 'text-white/30 line-through'
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
                 <button
                   onClick={() => showToast('Asset library synced — all nodes up to date.')}
                   className="flex items-center gap-1 text-xs border border-primary/30 text-primary px-4 py-1.5 hover:bg-primary/10 transition-colors uppercase font-space-grotesk tracking-wider"
                 >
                   <span className="material-symbols-outlined text-sm">cloud_sync</span>Sync
                 </button>
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
                    className="aspect-square bg-white/5 border border-white/10 rounded flex flex-col items-center justify-center hover:border-primary/50 hover:bg-primary/5 hover:-translate-y-1 transition-all cursor-pointer group"
                    onClick={() => showToast(`${label} embedded into active layer.`)}
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
