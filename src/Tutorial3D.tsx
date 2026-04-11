import { useState, useEffect, useRef, useCallback } from 'react';

/* ─── Data ─────────────────────────────────────────────────── */
const STEPS = [
  {
    id: 'welcome',
    icon: 'waving_hand',
    tag: 'WELCOME',
    title: 'Welcome to\nKinetic Singularity',
    body: 'An AI-powered spatial drawing studio where your hand gestures become art. This quick tour will show you how.',
    image: '/tutorial/gestures.png',
  },
  {
    id: 'gesture',
    icon: 'gesture',
    tag: 'HAND TRACKING',
    title: 'Draw with\nYour Hands',
    body: 'Pinch your thumb & index finger to start drawing. Open your hand to stop. Two-finger pinch to zoom & rotate the canvas.',
    image: '/tutorial/gestures.png',
  },
  {
    id: 'mouse',
    icon: 'edit',
    tag: 'MOUSE DRAWING',
    title: 'Draw with\nMouse & Layers',
    body: 'Switch to Mouse mode in the sidebar, then click & drag to draw. Organize work across multiple layers — each layer has its own strokes.',
    image: '/tutorial/drawing.png',
  },
  {
    id: 'text',
    icon: 'text_fields',
    tag: 'TEXT TOOL',
    title: 'Place Text\non Canvas',
    body: 'Activate the Text tool, click anywhere on the canvas, type your text and press Enter. Text renders as stylized particle dots.',
    image: '/tutorial/text.png',
  },
  {
    id: 'assets',
    icon: 'category',
    tag: 'ASSET LIBRARY',
    title: 'Embed Shapes\n& Assets',
    body: 'Open the Assets tab to browse geometric primitives. Click any shape to embed it on the active layer. Select, resize, and rotate freely.',
    image: '/tutorial/assets.png',
  },
  {
    id: 'ready',
    icon: 'rocket_launch',
    tag: 'YOU\'RE READY',
    title: 'Start Creating',
    body: 'You know the essentials. Open the Gestures panel for a full cheat-sheet. Now go make something extraordinary.',
    image: '/tutorial/gestures.png',
  },
];

/* ─── Component ────────────────────────────────────────────── */
export default function Tutorial3D({ onClose }: { onClose: () => void }) {
  const [step, setStep] = useState(0);
  const [transitioning, setTransitioning] = useState(false);
  const [direction, setDirection] = useState<'next' | 'prev'>('next');
  const containerRef = useRef<HTMLDivElement>(null);
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
    }, 350);
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
        {Array.from({ length: 30 }).map((_, i) => (
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

      {/* Main Card — 3D perspective container */}
      <div
        ref={containerRef}
        className="relative z-10 w-[90vw] max-w-5xl"
        style={{ perspective: '1600px' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Progress bar across the top */}
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
              ? `rotateY(${direction === 'next' ? -8 : 8}deg) scale(0.95)`
              : 'rotateY(0deg) scale(1)',
            transformOrigin: direction === 'next' ? 'right center' : 'left center',
          }}
        >
          <div className="grid grid-cols-1 md:grid-cols-2 min-h-[480px]">
            {/* Left — Content */}
            <div className="flex flex-col justify-between p-10 md:p-14 relative overflow-hidden">
              {/* Decorative gradient orb */}
              <div className="absolute -top-20 -left-20 w-64 h-64 bg-[#D4E4FC] rounded-full blur-3xl opacity-40 pointer-events-none" />

              <div className="relative z-10">
                {/* Tag pill */}
                <div className="inline-flex items-center gap-2 bg-[#D4E4FC] text-[#002746] px-4 py-1.5 rounded-full text-[10px] font-bold font-space-grotesk tracking-[0.2em] mb-6">
                  <span className="material-symbols-outlined text-sm">{data.icon}</span>
                  {data.tag}
                </div>

                {/* Title with line break */}
                <h2 className="text-3xl md:text-4xl font-bold font-space-grotesk text-[#002746] leading-tight tracking-tight mb-5 whitespace-pre-line">
                  {data.title}
                </h2>

                {/* Body */}
                <p className="text-base text-[#42474F] font-space-grotesk leading-relaxed max-w-sm">
                  {data.body}
                </p>
              </div>

              {/* Bottom controls */}
              <div className="flex items-center justify-between mt-10 relative z-10">
                {/* Dots */}
                <div className="flex gap-2">
                  {STEPS.map((_, i) => (
                    <button
                      key={i}
                      onClick={() => { setDirection(i > step ? 'next' : 'prev'); setStep(i); }}
                      className={`h-2 rounded-full transition-all duration-300 ${i === step
                        ? 'w-8 bg-[#003D6A]'
                        : 'w-2 bg-[#C2C7D0] hover:bg-[#003D6A]/40'
                        }`}
                    />
                  ))}
                </div>

                {/* Nav buttons */}
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
                      Get Started
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Right — 3D Image showcase */}
            <div className="relative bg-gradient-to-br from-[#EEF3F8] to-[#D4E4FC]/40 flex items-center justify-center overflow-hidden group">
              {/* Grid overlay for depth */}
              <div className="absolute inset-0 opacity-[0.04]" style={{
                backgroundImage: 'linear-gradient(#002746 1px, transparent 1px), linear-gradient(90deg, #002746 1px, transparent 1px)',
                backgroundSize: '40px 40px',
              }} />

              {/* Floating image with 3D transform */}
              <div
                className="relative w-[85%] aspect-square transition-all duration-700 ease-out"
                style={{
                  transform: transitioning
                    ? `perspective(1200px) rotateY(${direction === 'next' ? 30 : -30}deg) translateZ(-60px) scale(0.8)`
                    : 'perspective(1200px) rotateY(0deg) translateZ(0px) scale(1)',
                  opacity: transitioning ? 0 : 1,
                }}
              >
                <img
                  src={data.image}
                  alt={data.tag}
                  className="w-full h-full object-contain drop-shadow-[0_20px_40px_rgba(0,39,70,0.15)]"
                />
              </div>

              {/* Decorative rings */}
              <div className="absolute top-8 right-8 w-24 h-24 border border-[#003D6A]/10 rounded-full pointer-events-none group-hover:scale-125 transition-transform duration-700" />
              <div className="absolute bottom-12 left-8 w-16 h-16 border border-[#003D6A]/10 rounded-full pointer-events-none group-hover:scale-125 transition-transform duration-700 delay-100" />
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
