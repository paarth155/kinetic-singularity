import { useState, useEffect, useCallback } from 'react';

/* ─── Tutorial Steps — Practical How-To ─────────────────────── */
const STEPS = [
  {
    id: 'welcome',
    icon: 'waving_hand',
    tag: 'WELCOME',
    title: 'Let\'s learn\nthe basics',
    body: 'This quick guide will teach you exactly how to use Kinetic Singularity — from hand gestures to exporting your art.',
    visual: 'intro',
  },
  {
    id: 'camera',
    icon: 'videocam',
    tag: 'STEP 1 · CAMERA SETUP',
    title: 'Allow camera\naccess',
    body: 'When prompted, click "Allow" to enable your webcam. The app uses your camera to track your hands in real-time. Your video stays on your device — nothing is uploaded.',
    visual: 'camera',
    tips: ['Ensure good lighting — avoid backlighting', 'Sit 1–2 feet from the camera', 'Keep hands within the camera frame'],
  },
  {
    id: 'draw-right',
    icon: 'draw',
    tag: 'STEP 2 · DRAWING',
    title: 'Point to\ndraw',
    body: 'Use your RIGHT hand to draw. Point your index finger to start a stroke — the cursor follows your fingertip. Move your hand to draw. Close your fist or open all fingers to stop.',
    visual: 'pinch',
    gesture: { hand: '✋ Right Hand', action: 'Point Index Finger', result: 'Creates strokes on canvas' },
    tips: ['Point only your index finger to draw', 'Move slowly for smooth lines', 'Open hand or fist = stop drawing'],
  },
  {
    id: 'navigate-left',
    icon: 'open_with',
    tag: 'STEP 3 · NAVIGATION',
    title: 'Pan, zoom &\nrotate',
    body: 'Use your LEFT hand to navigate the canvas. Make a peace sign (✌️) to pan/move the canvas around. Pinch with two fingers to zoom in/out.',
    visual: 'navigate',
    gesture: { hand: '🤚 Left Hand', action: 'Peace Sign (✌️)', result: 'Pan and move the canvas' },
    tips: ['Peace sign = drag/pan the canvas', 'Pinch = zoom in and out', 'Open hand = stop navigating'],
  },
  {
    id: 'mouse-mode',
    icon: 'mouse',
    tag: 'STEP 4 · MOUSE MODE',
    title: 'Draw with\nyour mouse',
    body: 'Click "MOUSE" in the left sidebar to switch to mouse drawing mode. Click and drag on the canvas to draw strokes. Click it again to go back to hand tracking mode.',
    visual: 'mouse',
    tips: ['Great for precise, detailed work', 'Works alongside hand tracking', 'Change brush color & size in Brushes panel'],
  },
  {
    id: 'tools',
    icon: 'construction',
    tag: 'STEP 5 · TOOLS',
    title: 'Explore the\ntoolbar',
    body: 'The left sidebar has all your tools. Here\'s what each one does:',
    visual: 'tools',
    toolList: [
      { icon: 'near_me', name: 'Select', desc: 'Click strokes to select, move, or delete them' },
      { icon: 'brush', name: 'Brushes', desc: 'Change brush color, thickness, and style' },
      { icon: 'gesture', name: 'Mouse', desc: 'Toggle mouse drawing mode on/off' },
      { icon: 'text_fields', name: 'Text', desc: 'Click canvas to place text (renders as dots)' },
      { icon: 'layers', name: 'Layers', desc: 'Organize your work in separate layers' },
      { icon: 'upload', name: 'Export', desc: 'Save your art as SVG or PNG' },
    ],
  },
  {
    id: 'ready',
    icon: 'rocket_launch',
    tag: 'YOU\'RE READY!',
    title: 'Start\ncreating',
    body: 'You now know everything you need. Open the Gestures panel anytime for a reminder. The toolbar tutorial icon in your profile menu will bring you back here.',
    visual: 'ready',
    tips: ['Press CALIBRATE to reset the canvas', 'Use keyboard shortcuts for speed', 'Your work auto-saves locally'],
  },
];

/* ─── Component ────────────────────────────────────────────── */
export default function Tutorial3D({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const data = STEPS[step];
  const total = STEPS.length;
  const progress = ((step + 1) / total) * 100;

  const go = useCallback((dir: 'next' | 'prev') => {
    if (transitioning) return;
    setDirection(dir);
    setTransitioning(true);
    setTimeout(() => {
      setStep((s) => dir === 'next' ? Math.min(s + 1, total - 1) : Math.max(s - 1, 0));
      setTimeout(() => setTransitioning(false), 50);
    }, 300);
  }, [transitioning, total]);

  /* Keyboard navigation */
  useEffect(() => {
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'ArrowRight' || e.key === ' ') { e.preventDefault(); step < total - 1 ? go('next') : onClose(); }
      if (e.key === 'ArrowLeft') { e.preventDefault(); go('prev'); }
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [step, total, go, onClose]);

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center" onClick={onClose}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-gradient-to-br from-[#001D36]/80 via-[#002746]/70 to-[#003D6A]/60 backdrop-blur-xl" />

      {/* Floating particles */}
      <div className="absolute inset-0 overflow-hidden pointer-events-none">
        {Array.from({ length: 20 }).map((_, i) => (
          <div
            key={i}
            className="absolute rounded-full bg-white/10 animate-float-particle"
            style={{
              width: `${2 + Math.random() * 4}px`,
              height: `${2 + Math.random() * 4}px`,
              left: `${Math.random() * 100}%`,
              top: `${Math.random() * 100}%`,
              animationDelay: `${Math.random() * 8}s`,
              animationDuration: `${6 + Math.random() * 8}s`,
            }}
          />
        ))}
      </div>

      {/* Main Card */}
      <div
        className="relative z-10 w-[90vw] max-w-5xl"
        style={{ perspective: '1600px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar */}
        <div className="absolute -top-6 left-0 right-0 h-1 bg-white/10 rounded-full overflow-hidden">
          <div
            className="h-full bg-gradient-to-r from-[#9fcaff] to-white rounded-full transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>

        {/* Step counter */}
        <div className="absolute -top-12 right-0 text-white/30 text-xs font-space-grotesk tracking-widest">
          {String(step + 1).padStart(2, '0')} / {String(total).padStart(2, '0')}
        </div>

        {/* 3D rotating card */}
        <div
          className="bg-white/95 backdrop-blur-2xl rounded-[2.5rem] shadow-[0_32px_80px_rgba(0,29,54,0.4)] overflow-hidden transition-all duration-500"
          style={{
            transform: transitioning
              ? `rotateY(${direction === 'next' ? -6 : 6}deg) scale(0.97)`
              : 'rotateY(0deg) scale(1)',
            transformOrigin: direction === 'next' ? 'right center' : 'left center',
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 min-h-[520px]">
            {/* Left — Content */}
            <div className="flex flex-col justify-between p-10 md:p-12 relative overflow-hidden">
              <div className="absolute -top-20 -left-20 w-64 h-64 bg-[#D4E4FC] rounded-full blur-3xl opacity-40 pointer-events-none" />

              <div className="relative z-10 flex-1">
                {/* Tag pill */}
                <div className="inline-flex items-center gap-2 bg-[#D4E4FC] text-[#002746] px-4 py-1.5 rounded-full text-[10px] font-bold font-space-grotesk tracking-[0.15em] mb-5">
                  <span className="material-symbols-outlined text-sm">{data.icon}</span>
                  {data.tag}
                </div>

                {/* Title */}
                <h2 className="text-3xl md:text-4xl font-bold font-space-grotesk text-[#002746] leading-tight tracking-tight mb-4 whitespace-pre-line">
                  {data.title}
                </h2>

                {/* Body */}
                <p className="text-[15px] text-[#42474F] font-space-grotesk leading-relaxed max-w-sm mb-5">
                  {data.body}
                </p>

                {/* Gesture card */}
                {'gesture' in data && data.gesture && (
                  <div className="bg-gradient-to-r from-[#D4E4FC] to-[#EEF3F8] rounded-2xl p-4 mb-4">
                    <div className="flex items-center gap-3 mb-2">
                      <span className="text-xl">{data.gesture.hand}</span>
                      <span className="text-sm font-bold font-space-grotesk text-[#002746]">{data.gesture.action}</span>
                    </div>
                    <p className="text-xs text-[#42474F] font-space-grotesk pl-9">{data.gesture.result}</p>
                  </div>
                )}

                {/* Tool list */}
                {'toolList' in data && data.toolList && (
                  <div className="grid grid-cols-2 gap-2">
                    {data.toolList.map((tool) => (
                      <div key={tool.name} className="flex items-center gap-2 bg-[#F3F3F3] rounded-xl px-3 py-2">
                        <span className="material-symbols-outlined text-[#003D6A] text-base">{tool.icon}</span>
                        <div>
                          <p className="text-[11px] font-bold font-space-grotesk text-[#002746]">{tool.name}</p>
                          <p className="text-[9px] text-[#727780] font-space-grotesk leading-tight">{tool.desc}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {/* Tips */}
                {'tips' in data && data.tips && !('toolList' in data) && (
                  <div className="space-y-2">
                    {data.tips.map((tip, i) => (
                      <div key={i} className="flex items-center gap-2.5 text-sm text-[#42474F] font-space-grotesk">
                        <span className="w-5 h-5 rounded-full bg-[#D4E4FC] text-[#003D6A] text-[10px] flex items-center justify-center font-bold shrink-0">✓</span>
                        {tip}
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Bottom controls */}
              <div className="flex items-center justify-between mt-6 relative z-10">
                <div className="flex gap-2">
                  {STEPS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => { setDirection(i > step ? 'next' : 'prev'); setStep(i); }}
                      className={`h-2 rounded-full transition-all duration-300 ${i === step
                        ? 'w-8 bg-[#003D6A]'
                        : i < step ? 'w-2 bg-[#003D6A]/40' : 'w-2 bg-[#C2C7D0]'
                        }`}
                    />
                  ))}
                </div>

                <div className="flex gap-3">
                  {step > 0 && (
                    <button
                      onClick={() => go('prev')}
                      className="w-11 h-11 rounded-2xl bg-[#F3F3F3] hover:bg-[#E8E8E8] flex items-center justify-center text-[#42474F] transition-all active:scale-95"
                    >
                      <span className="material-symbols-outlined">arrow_back</span>
                    </button>
                  )}
                  {step < total - 1 ? (
                    <button
                      onClick={() => go('next')}
                      className="h-11 px-6 rounded-2xl bg-gradient-to-br from-[#002746] to-[#003D6A] text-white font-space-grotesk font-bold text-sm tracking-wider flex items-center gap-2 hover:shadow-[0_4px_20px_rgba(0,39,70,0.4)] transition-all active:scale-95"
                    >
                      Next
                      <span className="material-symbols-outlined text-lg">arrow_forward</span>
                    </button>
                  ) : (
                    <button
                      onClick={onClose}
                      className="h-11 px-8 rounded-2xl bg-gradient-to-br from-[#002746] to-[#003D6A] text-white font-space-grotesk font-bold text-sm tracking-wider flex items-center gap-2 hover:shadow-[0_4px_20px_rgba(0,39,70,0.4)] transition-all active:scale-95 animate-pulse"
                    >
                      <span className="material-symbols-outlined text-lg">rocket_launch</span>
                      Start Creating
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right — Visual demo panel */}
            <div className="relative bg-gradient-to-br from-[#EEF3F8] to-[#D4E4FC]/40 flex items-center justify-center overflow-hidden p-8">
              {/* Grid overlay */}
              <div className="absolute inset-0 opacity-[0.04]" style={{
                backgroundImage: 'linear-gradient(#002746 1px, transparent 1px), linear-gradient(90deg, #002746 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              }} />

              <div
                className="relative w-full max-w-sm transition-all duration-700 ease-out"
                style={{
                  transform: transitioning
                    ? `translateX(${direction === 'next' ? 40 : -40}px) scale(0.9)`
                    : 'translateX(0) scale(1)',
                  opacity: transitioning ? 0 : 1,
                }}
              >
                {/* Dynamic visual based on step */}
                {data.visual === 'intro' && (
                  <div className="text-center space-y-6">
                    <div className="w-32 h-32 mx-auto rounded-3xl bg-gradient-to-br from-[#002746] to-[#003D6A] flex items-center justify-center shadow-2xl">
                      <span className="material-symbols-outlined text-white text-6xl">gesture</span>
                    </div>
                    <p className="text-sm text-[#42474F] font-space-grotesk">7 quick steps · ~2 min</p>
                  </div>
                )}
                {data.visual === 'camera' && (
                  <div className="space-y-4 text-center">
                    <div className="w-full aspect-video bg-[#002746] rounded-2xl flex items-center justify-center relative overflow-hidden">
                      <div className="absolute inset-0 bg-gradient-to-br from-[#003D6A]/20 to-transparent" />
                      <div className="text-center z-10">
                        <span className="material-symbols-outlined text-white/70 text-5xl mb-2 block">videocam</span>
                        <p className="text-white/50 text-xs font-space-grotesk">Camera preview</p>
                      </div>
                      <div className="absolute bottom-3 right-3 w-3 h-3 rounded-full bg-green-400 animate-pulse" />
                    </div>
                    <div className="flex items-center justify-center gap-2 text-[#003D6A]">
                      <span className="material-symbols-outlined text-base">shield</span>
                      <span className="text-xs font-space-grotesk">100% private · processed locally</span>
                    </div>
                  </div>
                )}
                {data.visual === 'pinch' && (
                  <div className="space-y-6">
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-4xl">☝️</span>
                        <span className="material-symbols-outlined text-[#003D6A] text-3xl animate-pulse">arrow_forward</span>
                        <div className="w-16 h-1 bg-gradient-to-r from-[#003D6A] to-[#9fcaff] rounded-full" />
                      </div>
                      <p className="text-sm font-bold text-[#002746] font-space-grotesk">Point = Draw</p>
                      <p className="text-xs text-[#727780] font-space-grotesk mt-1">Extend index finger, curl others</p>
                    </div>
                    <div className="bg-white rounded-2xl p-6 shadow-lg">
                      <div className="flex items-center justify-between mb-4">
                        <span className="text-4xl">🖐️</span>
                        <span className="material-symbols-outlined text-[#C2C7D0] text-3xl">block</span>
                        <div className="w-16 h-1 bg-[#C2C7D0] rounded-full opacity-30" />
                      </div>
                      <p className="text-sm font-bold text-[#002746] font-space-grotesk">Open / Fist = Stop</p>
                      <p className="text-xs text-[#727780] font-space-grotesk mt-1">Open hand or close fist to stop</p>
                    </div>
                  </div>
                )}
                {data.visual === 'navigate' && (
                  <div className="space-y-4">
                    <div className="bg-white rounded-2xl p-5 shadow-lg flex items-center gap-4">
                      <span className="text-3xl">✌️</span>
                      <div>
                        <p className="text-sm font-bold text-[#002746] font-space-grotesk">Peace Sign = Pan</p>
                        <p className="text-xs text-[#727780] font-space-grotesk">Two fingers up, move to drag canvas</p>
                      </div>
                    </div>
                    <div className="bg-white rounded-2xl p-5 shadow-lg flex items-center gap-4">
                      <span className="text-3xl">🤏</span>
                      <div>
                        <p className="text-sm font-bold text-[#002746] font-space-grotesk">Pinch = Zoom</p>
                        <p className="text-xs text-[#727780] font-space-grotesk">Two-finger pinch to zoom in/out</p>
                      </div>
                    </div>
                    <div className="bg-white rounded-2xl p-5 shadow-lg flex items-center gap-4">
                      <span className="text-3xl">🔄</span>
                      <div>
                        <p className="text-sm font-bold text-[#002746] font-space-grotesk">Rotate = Turn</p>
                        <p className="text-xs text-[#727780] font-space-grotesk">Twist wrist while grabbing</p>
                      </div>
                    </div>
                  </div>
                )}
                {data.visual === 'mouse' && (
                  <div className="space-y-4 text-center">
                    <div className="bg-white rounded-2xl p-6 shadow-lg inline-block">
                      <div className="flex items-center gap-3 mb-4">
                        <div className="w-12 h-12 rounded-xl bg-[#003D6A] flex items-center justify-center">
                          <span className="material-symbols-outlined text-white text-2xl">gesture</span>
                        </div>
                        <span className="material-symbols-outlined text-[#C2C7D0]">swap_horiz</span>
                        <div className="w-12 h-12 rounded-xl bg-[#003D6A] flex items-center justify-center">
                          <span className="material-symbols-outlined text-white text-2xl">mouse</span>
                        </div>
                      </div>
                      <p className="text-xs text-[#727780] font-space-grotesk">Click sidebar to toggle</p>
                    </div>
                    <div className="bg-white rounded-2xl p-4 shadow-lg text-left">
                      <p className="text-sm font-bold text-[#002746] font-space-grotesk mb-2">Mouse Drawing:</p>
                      <div className="space-y-1.5 text-xs text-[#42474F] font-space-grotesk">
                        <p>• Click + drag = draw stroke</p>
                        <p>• Crosshair cursor shows when active</p>
                        <p>• Use Brushes panel for colors</p>
                      </div>
                    </div>
                  </div>
                )}
                {data.visual === 'tools' && (
                  <div className="bg-white rounded-2xl p-4 shadow-lg">
                    <div className="flex items-center gap-2 mb-3 pb-3 border-b border-black/5">
                      <span className="material-symbols-outlined text-[#003D6A]">dashboard</span>
                      <span className="text-sm font-bold font-space-grotesk text-[#002746]">Sidebar Overview</span>
                    </div>
                    <div className="space-y-1">
                      {[
                        { icon: 'near_me', label: 'Select' },
                        { icon: 'brush', label: 'Brushes' },
                        { icon: 'gesture', label: 'Mouse' },
                        { icon: 'text_fields', label: 'Text' },
                        { icon: 'pan_tool', label: 'Gestures' },
                        { icon: 'layers', label: 'Depth' },
                        { icon: 'upload', label: 'Export' },
                      ].map((item) => (
                        <div key={item.label} className="flex items-center gap-3 px-3 py-2 rounded-xl hover:bg-[#F3F3F3] transition-colors">
                          <span className="material-symbols-outlined text-[#003D6A] text-base">{item.icon}</span>
                          <span className="text-sm font-space-grotesk text-[#42474F]">{item.label}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
                {data.visual === 'ready' && (
                  <div className="text-center space-y-6">
                    <div className="w-32 h-32 mx-auto rounded-full bg-gradient-to-br from-[#002746] to-[#003D6A] flex items-center justify-center shadow-2xl animate-pulse">
                      <span className="material-symbols-outlined text-white text-6xl">rocket_launch</span>
                    </div>
                    <div>
                      <p className="text-lg font-bold text-[#002746] font-space-grotesk">You're all set!</p>
                      <p className="text-sm text-[#727780] font-space-grotesk mt-1">Time to create something amazing</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Decorative rings */}
              <div className="absolute top-8 right-8 w-24 h-24 border border-[#003D6A]/10 rounded-full pointer-events-none" />
              <div className="absolute bottom-12 left-8 w-16 h-16 border border-[#003D6A]/10 rounded-full pointer-events-none" />
            </div>
          </div>
        </div>

        {/* Skip button */}
        {step < total - 1 && (
          <button
            onClick={onClose}
            className="absolute -bottom-12 left-1/2 -translate-x-1/2 text-white/30 hover:text-white/70 text-xs font-space-grotesk tracking-widest uppercase transition-colors"
          >
            Skip Tutorial · ESC
          </button>
        )}
      </div>
    </div>
  );
}
