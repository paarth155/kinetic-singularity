/**
 * Skeleton loading screens for Kinetic Singularity.
 * Shows shimmer placeholders while the app initializes.
 */

/* ─── Shimmer primitive ──────────────────────────────────────── */
function Shimmer({ className = '' }: { className?: string }) {
  return (
    <div className={`bg-[#E8E8E8] rounded-2xl animate-pulse ${className}`} />
  );
}

/* ─── App Shell Skeleton ─────────────────────────────────────── */
export function AppSkeleton() {
  return (
    <div className="bg-[#FAFAFA] h-screen w-screen overflow-hidden relative flex flex-col">
      {/* Header skeleton */}
      <header className="flex justify-between items-center px-12 h-20 border-b border-black/5">
        <Shimmer className="w-56 h-6" />
        <div className="flex gap-8">
          <Shimmer className="w-14 h-4" />
          <Shimmer className="w-14 h-4" />
          <Shimmer className="w-14 h-4" />
        </div>
        <div className="flex items-center gap-5">
          <Shimmer className="w-7 h-7 rounded-full" />
          <Shimmer className="w-7 h-7 rounded-full" />
          <Shimmer className="w-7 h-7 rounded-full" />
          <Shimmer className="w-9 h-9 rounded-xl" />
        </div>
      </header>

      {/* Body */}
      <div className="flex-1 relative">
        {/* Sidebar skeleton */}
        <div className="absolute left-8 top-1/2 -translate-y-1/2 bg-white border border-black/5 flex flex-col py-6 px-3 gap-4 rounded-[2rem] shadow-[0_10px_30px_rgba(0,61,106,0.05)] w-[88px]">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-1.5">
              <Shimmer className="w-10 h-10 rounded-xl" />
              <Shimmer className="w-10 h-2" />
            </div>
          ))}
        </div>

        {/* Canvas skeleton — subtle grid shimmer */}
        <div className="absolute inset-0 ml-28 mr-16 my-4 rounded-3xl overflow-hidden">
          <div className="w-full h-full bg-white/60 relative">
            {/* Grid pattern */}
            <div className="absolute inset-0 opacity-[0.03]" style={{
              backgroundImage: 'linear-gradient(#002746 1px, transparent 1px), linear-gradient(90deg, #002746 1px, transparent 1px)',
              backgroundSize: '40px 40px',
            }} />
            {/* Center loading indicator */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 flex flex-col items-center gap-4">
              <div className="w-12 h-12 border-2 border-[#C2C7D0] border-t-[#003D6A] rounded-full animate-spin" />
              <span className="text-xs text-[#727780] font-space-grotesk tracking-widest uppercase">Loading workspace</span>
            </div>
          </div>
        </div>

        {/* Right toolbar skeleton */}
        <div className="absolute right-4 top-20 flex flex-col gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <Shimmer key={i} className="w-11 h-11 rounded-xl" />
          ))}
        </div>
      </div>

      {/* Status bar skeleton */}
      <div className="h-10 border-t border-black/5 flex items-center gap-6 px-8">
        <Shimmer className="w-24 h-3" />
        <Shimmer className="w-16 h-3" />
        <Shimmer className="w-20 h-3" />
      </div>
    </div>
  );
}

/* ─── Login Page Skeleton ────────────────────────────────────── */
export function LoginSkeleton() {
  return (
    <div className="fixed inset-0 z-[100] flex">
      {/* Left hero skeleton */}
      <div className="hidden lg:flex flex-col justify-between w-[55%] bg-[#001D36] p-14">
        <div className="flex items-center gap-3">
          <Shimmer className="w-10 h-10 rounded-xl !bg-white/10" />
          <Shimmer className="w-44 h-5 !bg-white/10" />
        </div>
        <div>
          <Shimmer className="w-96 h-12 mb-4 !bg-white/10" />
          <Shimmer className="w-72 h-12 mb-6 !bg-white/10" />
          <Shimmer className="w-80 h-4 !bg-white/10" />
          <Shimmer className="w-64 h-4 mt-2 !bg-white/10" />
        </div>
        <div className="flex gap-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Shimmer key={i} className="w-28 h-9 rounded-full !bg-white/10" />
          ))}
        </div>
      </div>

      {/* Right form skeleton */}
      <div className="flex-1 flex items-center justify-center bg-[#FAFAFA]">
        <div className="w-full max-w-md px-8">
          <Shimmer className="w-56 h-8 mb-3" />
          <Shimmer className="w-72 h-4 mb-8" />
          <Shimmer className="w-full h-12 mb-4 rounded-2xl" />
          <Shimmer className="w-full h-12 mb-6 rounded-2xl" />
          <Shimmer className="w-full h-14 rounded-2xl !bg-[#002746]/20" />
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-[#C2C7D0]/30" />
            <Shimmer className="w-6 h-3" />
            <div className="flex-1 h-px bg-[#C2C7D0]/30" />
          </div>
          <Shimmer className="w-full h-12 rounded-2xl" />
        </div>
      </div>
    </div>
  );
}
