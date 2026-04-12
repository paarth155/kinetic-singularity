import { useState, useRef, useEffect } from 'react';
import { supabase } from './lib/supabase';
import type { User } from '@supabase/supabase-js';

/* ─── Types ────────────────────────────────────────────────── */
export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  isNew: boolean;
};

type Props = {
  onLogin: (user: AuthUser) => void;
};

/* ─── Component ────────────────────────────────────────────── */
export default function LoginPage({ onLogin }: Props) {
  const [mode, setMode] = useState<'login' | 'signup' | 'confirm'>('login');
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [mounted, setMounted] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { setMounted(true); inputRef.current?.focus(); }, []);
  useEffect(() => { setError(''); }, [mode]);

  const mapUser = (user: User, isNew: boolean): AuthUser => ({
    id: user.id,
    email: user.email || '',
    displayName: user.user_metadata?.display_name || user.email?.split('@')[0] || 'User',
    isNew,
  });

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!email.trim() || !password.trim()) { setError('All fields are required'); return; }
    if (mode === 'signup' && !displayName.trim()) { setError('Display name is required'); return; }
    if (password.length < 6) { setError('Password must be at least 6 characters'); return; }

    setLoading(true);

    try {
      if (mode === 'signup') {
        const { data, error: signUpError } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            data: { display_name: displayName.trim() },
          },
        });

        if (signUpError) { setError(signUpError.message); setLoading(false); return; }
        if (!data.user) { setError('Signup failed. Please try again.'); setLoading(false); return; }

        if (data.session) {
          // Auto-confirmed — proceed directly
          onLogin(mapUser(data.user, true));
        } else {
          // Email confirmation needed — show confirmation screen
          setMode('confirm');
          setLoading(false);
        }
      } else {
        const { data, error: signInError } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (signInError) { setError(signInError.message); setLoading(false); return; }
        if (!data.user) { setError('Login failed. Please try again.'); setLoading(false); return; }

        // Check if it's a first-time login (user just confirmed email)
        const createdAt = new Date(data.user.created_at).getTime();
        const now = Date.now();
        const isFirstLogin = (now - createdAt) < 5 * 60 * 1000; // within 5 minutes of creation
        onLogin(mapUser(data.user, isFirstLogin && !localStorage.getItem('ks-tutorial-done')));
      }
    } catch (err) {
      setError('Network error. Please check your connection.');
      setLoading(false);
    }
  };

  /* ─── Email Confirmation Screen ─────────────────────────── */
  if (mode === 'confirm') {
    return (
      <div className={`fixed inset-0 z-[100] flex transition-opacity duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
        {/* Left panel — Hero */}
        <div className="hidden lg:flex flex-col justify-between w-[55%] relative overflow-hidden bg-[#001D36]">
          <img src="/login-hero.png" alt="Kinetic Singularity" className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-lighten" />
          <div className="absolute inset-0 bg-gradient-to-r from-[#001D36] via-[#001D36]/60 to-transparent" />
          <div className="absolute inset-0 bg-gradient-to-t from-[#001D36] via-transparent to-[#001D36]/40" />
          <div className="relative z-10 p-14 flex flex-col h-full justify-between">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/10">
                <span className="material-symbols-outlined text-white text-xl">gesture</span>
              </div>
              <span className="text-white/90 font-space-grotesk font-bold text-lg tracking-tight">KINETIC_SINGULARITY</span>
            </div>
            <div className="max-w-lg">
              <h1 className="text-5xl xl:text-6xl font-bold font-space-grotesk text-white leading-[1.1] tracking-tight mb-6">
                Almost<br />there<span className="text-[#9fcaff]">!</span>
              </h1>
              <p className="text-white/50 text-lg font-space-grotesk leading-relaxed max-w-sm">
                One last step before you can start creating with hand gestures.
              </p>
            </div>
            <div className="flex gap-3 flex-wrap">
              {['Hand Tracking', 'Multi-Layer', 'Real-time', 'Export SVG'].map((f) => (
                <span key={f} className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/40 text-xs font-space-grotesk tracking-wider backdrop-blur-sm">
                  {f}
                </span>
              ))}
            </div>
          </div>
        </div>

        {/* Right panel — Confirmation */}
        <div className="flex-1 flex items-center justify-center bg-[#FAFAFA] relative overflow-hidden">
          <div className="absolute -top-32 -right-32 w-96 h-96 bg-[#D4E4FC] rounded-full blur-[100px] opacity-40 pointer-events-none" />
          <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-[#9fcaff] rounded-full blur-[80px] opacity-20 pointer-events-none" />

          <div className={`w-full max-w-md px-8 text-center transition-all duration-500 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
            {/* Checkmark animation */}
            <div className="w-24 h-24 mx-auto mb-8 rounded-full bg-gradient-to-br from-[#D4E4FC] to-[#9fcaff]/30 flex items-center justify-center">
              <span className="material-symbols-outlined text-[#003D6A] text-5xl">mark_email_read</span>
            </div>

            <h2 className="text-3xl font-bold font-space-grotesk text-[#002746] tracking-tight mb-3">
              Verify your email
            </h2>
            <p className="text-[#42474F] text-sm font-space-grotesk leading-relaxed mb-2">
              We sent a confirmation link to:
            </p>
            <p className="text-[#003D6A] font-bold font-space-grotesk text-lg mb-8 break-all">
              {email}
            </p>

            <div className="bg-[#D4E4FC]/50 rounded-2xl p-5 mb-8 text-left">
              <div className="flex items-start gap-3">
                <span className="material-symbols-outlined text-[#003D6A] text-lg mt-0.5">info</span>
                <div>
                  <p className="text-sm text-[#002746] font-space-grotesk font-semibold mb-1">What's next?</p>
                  <ol className="text-sm text-[#42474F] font-space-grotesk space-y-1.5">
                    <li className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#003D6A] text-white text-[10px] flex items-center justify-center font-bold shrink-0">1</span>
                      Open your email inbox
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#003D6A] text-white text-[10px] flex items-center justify-center font-bold shrink-0">2</span>
                      Click the confirmation link
                    </li>
                    <li className="flex items-center gap-2">
                      <span className="w-5 h-5 rounded-full bg-[#003D6A] text-white text-[10px] flex items-center justify-center font-bold shrink-0">3</span>
                      Come back here and sign in
                    </li>
                  </ol>
                </div>
              </div>
            </div>

            <button
              onClick={() => setMode('login')}
              className="w-full bg-gradient-to-br from-[#002746] to-[#003D6A] hover:from-[#003D6A] hover:to-[#004D85] text-white font-space-grotesk font-bold tracking-wider text-sm py-4 rounded-2xl transition-all shadow-[0_4px_16px_rgba(0,39,70,0.25)] hover:shadow-[0_6px_24px_rgba(0,39,70,0.35)] active:translate-y-0.5 flex items-center justify-center gap-2"
            >
              <span className="material-symbols-outlined text-lg">login</span>
              Go to Sign In
            </button>

            <p className="text-center text-[10px] text-[#C2C7D0] mt-8 font-space-grotesk tracking-wider">
              Didn't receive it? Check your spam folder
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={`fixed inset-0 z-[100] flex transition-opacity duration-700 ${mounted ? 'opacity-100' : 'opacity-0'}`}>
      {/* Left panel — Hero */}
      <div className="hidden lg:flex flex-col justify-between w-[55%] relative overflow-hidden bg-[#001D36]">
        {/* Hero image */}
        <img
          src="/login-hero.png"
          alt="Kinetic Singularity"
          className="absolute inset-0 w-full h-full object-cover opacity-60 mix-blend-lighten"
        />
        {/* Gradient overlay */}
        <div className="absolute inset-0 bg-gradient-to-r from-[#001D36] via-[#001D36]/60 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#001D36] via-transparent to-[#001D36]/40" />

        {/* Content over hero */}
        <div className="relative z-10 p-14 flex flex-col h-full justify-between">
          {/* Logo */}
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-white/10 backdrop-blur-sm flex items-center justify-center border border-white/10">
              <span className="material-symbols-outlined text-white text-xl">gesture</span>
            </div>
            <span className="text-white/90 font-space-grotesk font-bold text-lg tracking-tight">KINETIC_SINGULARITY</span>
          </div>

          {/* Headline */}
          <div className="max-w-lg">
            <h1 className="text-5xl xl:text-6xl font-bold font-space-grotesk text-white leading-[1.1] tracking-tight mb-6">
              Where gestures
              <br />
              become <span className="text-[#9fcaff]">art</span>
            </h1>
            <p className="text-white/50 text-lg font-space-grotesk leading-relaxed max-w-sm">
              AI-powered spatial drawing studio. Draw with your hands, mouse, or touch. Export in any format.
            </p>
          </div>

          {/* Feature pills */}
          <div className="flex gap-3 flex-wrap">
            {['Hand Tracking', 'Multi-Layer', 'Real-time', 'Export SVG'].map((f) => (
              <span key={f} className="px-4 py-2 rounded-full bg-white/5 border border-white/10 text-white/40 text-xs font-space-grotesk tracking-wider backdrop-blur-sm">
                {f}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Right panel — Auth form */}
      <div className="flex-1 flex items-center justify-center bg-[#FAFAFA] relative overflow-hidden">
        {/* Decorative blobs */}
        <div className="absolute -top-32 -right-32 w-96 h-96 bg-[#D4E4FC] rounded-full blur-[100px] opacity-40 pointer-events-none" />
        <div className="absolute -bottom-20 -left-20 w-64 h-64 bg-[#9fcaff] rounded-full blur-[80px] opacity-20 pointer-events-none" />

        <div className={`w-full max-w-md px-8 transition-all duration-500 ${mounted ? 'translate-y-0 opacity-100' : 'translate-y-8 opacity-0'}`}>
          {/* Mobile logo */}
          <div className="lg:hidden flex items-center gap-3 mb-10 justify-center">
            <div className="w-10 h-10 rounded-xl bg-[#002746] flex items-center justify-center">
              <span className="material-symbols-outlined text-white text-xl">gesture</span>
            </div>
            <span className="text-[#002746] font-space-grotesk font-bold text-lg tracking-tight">KINETIC_SINGULARITY</span>
          </div>

          {/* Header */}
          <div className="mb-8">
            <h2 className="text-3xl font-bold font-space-grotesk text-[#002746] tracking-tight">
              {mode === 'login' ? 'Welcome back' : 'Create account'}
            </h2>
            <p className="text-[#42474F] text-sm mt-2 font-space-grotesk">
              {mode === 'login'
                ? 'Sign in to continue to your workspace'
                : 'Join to start creating with hand gestures'}
            </p>
          </div>

          {/* Form */}
          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-xs font-semibold font-space-grotesk text-[#002746] mb-1.5 tracking-wider uppercase">
                  Display Name
                </label>
                <div className="relative">
                  <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[#C2C7D0] text-lg">person</span>
                  <input
                    type="text"
                    value={displayName}
                    onChange={(e) => setDisplayName(e.target.value)}
                    placeholder="Your name"
                    className="w-full bg-white border border-[#C2C7D0]/40 focus:border-[#003D6A] rounded-2xl pl-11 pr-4 py-3.5 text-sm text-[#002746] font-space-grotesk outline-none transition-all focus:shadow-[0_0_0_3px_rgba(0,61,106,0.1)]"
                  />
                </div>
              </div>
            )}

            <div>
              <label className="block text-xs font-semibold font-space-grotesk text-[#002746] mb-1.5 tracking-wider uppercase">
                Email
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[#C2C7D0] text-lg">mail</span>
                <input
                  ref={inputRef}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com"
                  autoComplete="email"
                  className="w-full bg-white border border-[#C2C7D0]/40 focus:border-[#003D6A] rounded-2xl pl-11 pr-4 py-3.5 text-sm text-[#002746] font-space-grotesk outline-none transition-all focus:shadow-[0_0_0_3px_rgba(0,61,106,0.1)]"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold font-space-grotesk text-[#002746] mb-1.5 tracking-wider uppercase">
                Password
              </label>
              <div className="relative">
                <span className="material-symbols-outlined absolute left-3.5 top-1/2 -translate-y-1/2 text-[#C2C7D0] text-lg">lock</span>
                <input
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
                  className="w-full bg-white border border-[#C2C7D0]/40 focus:border-[#003D6A] rounded-2xl pl-11 pr-4 py-3.5 text-sm text-[#002746] font-space-grotesk outline-none transition-all focus:shadow-[0_0_0_3px_rgba(0,61,106,0.1)]"
                />
              </div>
            </div>

            {/* Error / Info */}
            {error && (
              <div className="flex items-center gap-2 text-sm px-4 py-2.5 rounded-xl font-space-grotesk text-[#ba1a1a] bg-[#ffdad6]">
                <span className="material-symbols-outlined text-base">error</span>
                {error}
              </div>
            )}

            {/* Submit */}
            <button
              type="submit"
              disabled={loading}
              className="w-full bg-gradient-to-br from-[#002746] to-[#003D6A] hover:from-[#003D6A] hover:to-[#004D85] text-white font-space-grotesk font-bold tracking-wider text-sm py-4 rounded-2xl transition-all shadow-[0_4px_16px_rgba(0,39,70,0.25)] hover:shadow-[0_6px_24px_rgba(0,39,70,0.35)] active:translate-y-0.5 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
            >
              {loading ? (
                <div className="w-5 h-5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <>
                  <span className="material-symbols-outlined text-lg">{mode === 'login' ? 'login' : 'person_add'}</span>
                  {mode === 'login' ? 'Sign In' : 'Create Account'}
                </>
              )}
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-4 my-6">
            <div className="flex-1 h-px bg-[#C2C7D0]/30" />
            <span className="text-xs text-[#727780] font-space-grotesk">or</span>
            <div className="flex-1 h-px bg-[#C2C7D0]/30" />
          </div>

          {/* Toggle mode */}
          <button
            onClick={() => setMode(mode === 'login' ? 'signup' : 'login')}
            className="w-full py-3.5 rounded-2xl border border-[#C2C7D0]/40 hover:border-[#003D6A]/40 text-[#002746] text-sm font-space-grotesk font-semibold transition-all hover:bg-[#F3F3F3]"
          >
            {mode === 'login' ? "Don't have an account? Sign Up" : 'Already have an account? Sign In'}
          </button>

          {/* Guest mode */}
          <button
            onClick={() => onLogin({ id: `guest-${Date.now()}`, email: '', displayName: 'Guest', isNew: true })}
            className="w-full py-3 rounded-2xl text-[#727780] text-sm font-space-grotesk transition-all hover:text-[#002746] hover:bg-[#F3F3F3] flex items-center justify-center gap-2 mt-2"
          >
            <span className="material-symbols-outlined text-base">person_outline</span>
            Continue as Guest
          </button>

          {/* Footer */}
          <p className="text-center text-[10px] text-[#C2C7D0] mt-6 font-space-grotesk tracking-wider">
            KINETIC SINGULARITY · AI HAND-GESTURE DRAWING STUDIO
          </p>
        </div>
      </div>
    </div>
  );
}
