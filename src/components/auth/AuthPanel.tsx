'use client';

import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';
import { toast } from 'sonner';
import {
  signInSchema,
  signUpSchema,
  forgotPasswordSchema,
  fieldErrors,
} from '@/lib/schemas';
import { spectral, hanken } from '@/app/auth/fonts';

type Mode = 'login' | 'signup' | 'forgot';

// Recolored from the original earthy design to the app's dark blue/slate theme
// (matches the #1b2735 → #090a0f auth gradient, blue-600/500 primary, blue-400
// accent used across the app).
const ACCENT = '#60a5fa'; // blue-400

const label: React.CSSProperties = {
  display: 'block',
  fontSize: 11,
  letterSpacing: '1.5px',
  textTransform: 'uppercase',
  color: '#7e90a8',
  fontWeight: 600,
  marginBottom: 8,
};

const input: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: 'rgba(255,255,255,0.04)',
  border: '1.5px solid rgba(255,255,255,0.12)',
  borderRadius: 11,
  padding: '13px 15px',
  fontSize: 15,
  color: '#eef3fa',
  fontFamily: 'var(--font-hanken), sans-serif',
  transition: 'all .2s ease',
};

const primaryBtn: React.CSSProperties = {
  width: '100%',
  appearance: 'none',
  cursor: 'pointer',
  background: '#2563eb',
  color: '#f3f6fb',
  border: 'none',
  borderRadius: 12,
  padding: 15,
  fontFamily: 'var(--font-hanken), sans-serif',
  fontSize: 15.5,
  fontWeight: 600,
  letterSpacing: '0.3px',
  boxShadow: '0 0 20px rgba(37,99,235,0.35)',
  transition: 'all .25s ease',
};

const linkBtn: React.CSSProperties = {
  appearance: 'none',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  fontFamily: 'var(--font-hanken), sans-serif',
  fontSize: 13.5,
  fontWeight: 700,
  color: ACCENT,
};

const errText: React.CSSProperties = {
  margin: '6px 0 0',
  fontSize: 12.5,
  color: '#f87171',
};

const heading: React.CSSProperties = {
  fontFamily: 'var(--font-spectral), serif',
  fontSize: 32,
  fontWeight: 600,
  color: '#f3f6fb',
  marginBottom: 7,
};

const subheading: React.CSSProperties = {
  fontSize: 14.5,
  color: '#9fb0c7',
  marginBottom: 30,
};

const fieldWrap: React.CSSProperties = { marginBottom: 18 };

const eyeBtn: React.CSSProperties = {
  position: 'absolute',
  right: 12,
  top: '50%',
  transform: 'translateY(-50%)',
  appearance: 'none',
  background: 'none',
  border: 'none',
  cursor: 'pointer',
  display: 'flex',
  alignItems: 'center',
  padding: 0,
  transition: 'color .2s ease',
};

type AccountType = 'trekker' | 'company';

function AccountTypeToggle({
  value,
  onChange,
  legend,
  hint,
}: {
  value: AccountType;
  onChange: (next: AccountType) => void;
  legend: string;
  hint: string;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <label style={label}>{legend}</label>
      <div style={{ display: 'flex', gap: 8 }}>
        {(['trekker', 'company'] as const).map((kind) => {
          const active = value === kind;
          return (
            <button
              key={kind}
              type="button"
              onClick={() => onChange(kind)}
              style={{
                flex: 1,
                appearance: 'none',
                cursor: 'pointer',
                borderRadius: 11,
                padding: '11px 12px',
                fontFamily: 'var(--font-hanken), sans-serif',
                fontSize: 13.5,
                fontWeight: 600,
                transition: 'all .2s ease',
                background: active ? 'rgba(96,165,250,0.14)' : 'rgba(255,255,255,0.04)',
                border: `1.5px solid ${active ? ACCENT : 'rgba(255,255,255,0.12)'}`,
                color: active ? '#eef3fa' : '#7e90a8',
              }}
            >
              {kind === 'trekker' ? 'A trekker' : 'A trek company'}
            </button>
          );
        })}
      </div>
      <p style={{ margin: '8px 0 0', fontSize: 12, color: '#7e90a8', lineHeight: 1.5 }}>{hint}</p>
    </div>
  );
}

const covers: Record<Mode, { kicker: string; title: string; sub: string }> = {
  login: {
    kicker: 'into the wild',
    title: 'Let’s go for treks with the unknowns.',
    sub: 'Maps end where the good stuff begins. Pick up where your last trail left off.',
  },
  forgot: {
    kicker: 'find your way',
    title: 'Every wrong turn is still a trail.',
    sub: 'We’ll help you back to base camp in a couple of taps.',
  },
  signup: {
    kicker: 'first steps',
    title: 'The unknown is better with a pack.',
    sub: 'Join a crew of trekkers who chase ridgelines, not comfort zones.',
  },
};

export default function AuthPanel({ initialMode = 'login' }: { initialMode?: Mode }) {
  const [mode, setMode] = useState<Mode>(initialMode);
  const [login, setLogin] = useState({
    email: '',
    password: '',
    rememberMe: false,
    accountType: 'trekker' as AccountType,
  });
  const [signup, setSignup] = useState({
    fullName: '',
    email: '',
    password: '',
    agree: false,
    accountType: 'trekker' as AccountType,
  });
  const [forgotEmail, setForgotEmail] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [showPw, setShowPw] = useState(false);
  const [forgotSent, setForgotSent] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const go = (next: Mode) => {
    setErrors({});
    setForgotSent(false);
    setMode(next);
  };

  const clearErr = (name: string) =>
    setErrors((prev) => (prev[name] ? { ...prev, [name]: '' } : prev));

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = signInSchema.safeParse({ email: login.email, password: login.password });
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const asCompany = login.accountType === 'company';
      const { signInAs } = await import('@/lib/auth');
      const { user, error, mismatch } = await signInAs({
        email: login.email,
        password: login.password,
        accountType: login.accountType,
      });
      if (mismatch) {
        // Says only that no account of the picked kind exists — confirming
        // "that's a company account" would let anyone holding the credentials
        // probe which kind an email is registered as.
        toast.error(
          asCompany
            ? 'No company account found with that email.'
            : 'No trekker account found with that email.'
        );
      } else if (error) {
        toast.error(`Login failed: ${error.message}`);
      } else if (user) {
        toast.success('Login successful!');
        // Company accounts have no trekker home to land on — send them to the
        // dashboard, which routes them onward to /company/apply if they haven't
        // registered a company yet.
        // Delay the hard redirect so the toast is visible before navigation wipes it.
        setTimeout(() => { window.location.href = asCompany ? '/dashboard' : '/'; }, 800);
        return;
      }
    } catch (err) {
      console.error('Login error:', err);
      toast.error('An unexpected error occurred. Please try again.');
    }
    setSubmitting(false);
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();
    // The design has no confirm-password field, so mirror password into
    // confirmPassword to satisfy the shared schema's match check without
    // changing the (still 8-char min + HIBP) backend rules.
    const result = signUpSchema.safeParse({
      fullName: signup.fullName,
      email: signup.email,
      password: signup.password,
      confirmPassword: signup.password,
    });
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }
    if (!signup.agree) {
      setErrors({ agree: 'Please agree to the terms & trail code.' });
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const { signUp } = await import('@/lib/auth');
      const { user, error } = await signUp({
        email: signup.email,
        password: signup.password,
        fullName: signup.fullName,
        accountType: signup.accountType,
      });
      if (error) {
        toast.error(`Signup failed: ${error.message}`);
      } else if (user) {
        toast.success(
          signup.accountType === 'company'
            ? 'Account created! Verify your email, then sign in to register your company.'
            : 'Account created! Check your email to verify your account.'
        );
        setSignup({ fullName: '', email: '', password: '', agree: false, accountType: signup.accountType });
        setTimeout(() => go('login'), 1200);
      }
    } catch (err) {
      console.error('Signup error:', err);
      toast.error('An unexpected error occurred. Please try again.');
    }
    setSubmitting(false);
  };

  const handleForgot = async (e: React.FormEvent) => {
    e.preventDefault();
    const result = forgotPasswordSchema.safeParse({ email: forgotEmail });
    if (!result.success) {
      setErrors(fieldErrors(result.error));
      return;
    }
    setErrors({});
    setSubmitting(true);
    try {
      const { resetPassword } = await import('@/lib/auth');
      const { error } = await resetPassword(forgotEmail);
      if (error) {
        toast.error(`Password reset failed: ${error.message}`);
      } else {
        setForgotSent(true);
        toast.success('Reset link sent — check your email.');
      }
    } catch (err) {
      console.error('Password reset error:', err);
      toast.error('An unexpected error occurred. Please try again.');
    }
    setSubmitting(false);
  };

  const coverRight = mode === 'signup';
  const cover = covers[mode];
  const isCompanySignup = signup.accountType === 'company';
  const isCompanyLogin = login.accountType === 'company';
  const prompt = coverRight
    ? { q: 'Already roped in?', cta: 'Sign in', action: () => go('login') }
    : { q: 'New to the unknown?', cta: 'Create account', action: () => go('signup') };

  const vis = (on: boolean): React.CSSProperties => ({
    opacity: on ? 1 : 0,
    transform: on ? 'translateY(0px)' : 'translateY(22px)',
    pointerEvents: on ? 'auto' : 'none',
  });

  const formBase: React.CSSProperties = {
    position: 'absolute',
    top: 0,
    height: '100%',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    boxSizing: 'border-box',
    padding: '56px 64px',
    transition: 'opacity .55s ease, transform .55s ease',
  };

  return (
    <div
      className={`${spectral.variable} ${hanken.variable}`}
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'linear-gradient(to bottom, #1b2735 0%, #090a0f 100%)',
        fontFamily: 'var(--font-hanken), sans-serif',
        padding: 32,
        boxSizing: 'border-box',
      }}
    >
      <div
        className="auth-card"
        style={{
          position: 'relative',
          width: 1040,
          height: 680,
          maxWidth: '100%',
          background: '#0e1626',
          borderRadius: 22,
          overflow: 'hidden',
          boxShadow: '0 40px 90px -30px rgba(0,0,0,0.7), 0 0 0 1px rgba(255,255,255,0.05) inset',
        }}
      >
        {/* ====== SLIDING COVER PANEL ====== */}
        <div
          className="auth-cover"
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: '50%',
            height: '100%',
            zIndex: 20,
            transform: coverRight ? 'translateX(100%)' : 'translateX(0px)',
            transition: 'transform .75s cubic-bezier(.76,0,.24,1)',
            overflow: 'hidden',
          }}
        >
          {/* Cover photo: drop your trek image at public/auth-cover.jpg. If the
              file is absent the dark gradient overlay below still renders fine. */}
          <div
            style={{
              position: 'absolute',
              inset: 0,
              backgroundImage: "url('/auth-cover.jpg')",
              backgroundSize: 'cover',
              backgroundPosition: 'center',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              background:
                'linear-gradient(150deg, rgba(27,39,53,0.86) 0%, rgba(20,30,48,0.72) 45%, rgba(9,12,20,0.94) 100%)',
            }}
          />
          <div
            style={{
              position: 'absolute',
              inset: 0,
              opacity: 0.45,
              background: 'linear-gradient(180deg, rgba(9,12,20,0.1), rgba(9,12,20,0.55))',
            }}
          />

          <div
            style={{
              position: 'relative',
              zIndex: 3,
              height: '100%',
              boxSizing: 'border-box',
              padding: '46px 48px',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'space-between',
              color: '#e6edf6',
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 11 }}>
              <div
                style={{
                  width: 30,
                  height: 30,
                  border: '1.5px solid rgba(147,197,253,0.8)',
                  borderRadius: '50%',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  fontFamily: 'var(--font-spectral), serif',
                  fontSize: 15,
                  fontWeight: 600,
                }}
              >
                t
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-spectral), serif',
                  fontSize: 21,
                  fontWeight: 600,
                  letterSpacing: '0.5px',
                }}
              >
                trekker
              </div>
              <div
                style={{
                  marginLeft: 6,
                  fontSize: 9.5,
                  letterSpacing: '3px',
                  textTransform: 'uppercase',
                  opacity: 0.7,
                  alignSelf: 'center',
                  paddingTop: 3,
                }}
              >
                est. wild
              </div>
            </div>

            <div>
              <div
                style={{
                  fontSize: 11,
                  letterSpacing: '4px',
                  textTransform: 'uppercase',
                  opacity: 0.75,
                  marginBottom: 18,
                }}
              >
                {cover.kicker}
              </div>
              <div
                style={{
                  fontFamily: 'var(--font-spectral), serif',
                  fontSize: 42,
                  lineHeight: 1.08,
                  fontWeight: 500,
                  textWrap: 'balance',
                  maxWidth: 380,
                }}
              >
                {cover.title}
              </div>
              <div style={{ marginTop: 18, fontSize: 14.5, lineHeight: 1.6, opacity: 0.82, maxWidth: 330 }}>
                {cover.sub}
              </div>
            </div>

            <div style={{ borderTop: '1px solid rgba(230,237,246,0.22)', paddingTop: 22 }}>
              <div style={{ fontSize: 13.5, opacity: 0.8, marginBottom: 13 }}>{prompt.q}</div>
              <button
                type="button"
                className="trk-cta"
                onClick={prompt.action}
                style={{
                  appearance: 'none',
                  cursor: 'pointer',
                  background: 'transparent',
                  border: '1.5px solid rgba(230,237,246,0.6)',
                  color: '#e6edf6',
                  fontFamily: 'var(--font-hanken), sans-serif',
                  fontWeight: 600,
                  fontSize: 14,
                  letterSpacing: '0.3px',
                  padding: '12px 26px',
                  borderRadius: 11,
                  transition: 'all .25s ease',
                }}
              >
                {prompt.cta}
              </button>
            </div>
          </div>
        </div>

        {/* ====== LOGIN FORM (right) ====== */}
        <form
          onSubmit={handleLogin}
          className={`auth-form${mode === 'login' ? ' active' : ''}`}
          style={{ ...formBase, right: 0, width: '50%', ...vis(mode === 'login') }}
        >
          <div style={{ width: '100%', maxWidth: 344 }}>
            <div style={heading}>Welcome back</div>
            <div style={{ ...subheading, marginBottom: 20 }}>
              {isCompanyLogin
                ? 'Sign in to manage your company’s treks and departures.'
                : 'The trail’s been waiting. Sign in to keep going.'}
            </div>

            <AccountTypeToggle
              value={login.accountType}
              onChange={(kind) => { setLogin({ ...login, accountType: kind }); setErrors({}); }}
              legend="I’m signing in as"
              hint={
                isCompanyLogin
                  ? 'Takes you to your company dashboard. Company accounts don’t book treks.'
                  : 'Takes you to your trails, bookings and batch chats.'
              }
            />

            <div style={fieldWrap}>
              <label style={label}>Email</label>
              <input
                className="trk-in"
                type="email"
                autoComplete="email"
                placeholder="you@trail.com"
                value={login.email}
                onChange={(e) => { setLogin({ ...login, email: e.target.value }); clearErr('email'); }}
                style={input}
              />
              {errors.email && <p style={errText}>{errors.email}</p>}
            </div>

            <div style={fieldWrap}>
              <label style={label}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="trk-in"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="current-password"
                  placeholder="••••••••"
                  value={login.password}
                  onChange={(e) => { setLogin({ ...login, password: e.target.value }); clearErr('password'); }}
                  style={{ ...input, paddingRight: 44 }}
                />
                <button type="button" className="trk-eye" onClick={() => setShowPw((v) => !v)} style={eyeBtn} aria-label="Toggle password visibility">
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && <p style={errText}>{errors.password}</p>}
            </div>

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '8px 0 26px' }}>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13.5, color: '#9fb0c7', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={login.rememberMe}
                  onChange={(e) => setLogin({ ...login, rememberMe: e.target.checked })}
                  style={{ accentColor: ACCENT, width: 16, height: 16 }}
                />
                Remember me
              </label>
              <button type="button" className="trk-link" onClick={() => go('forgot')} style={{ ...linkBtn, fontWeight: 600 }}>
                Forgot password?
              </button>
            </div>

            <button type="submit" className="trk-primary" disabled={submitting} style={primaryBtn}>
              {submitting ? 'Signing in…' : 'Sign in'}
            </button>

            <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13.5, color: '#9fb0c7' }}>
              New to the unknown?{' '}
              <button type="button" className="trk-link" onClick={() => go('signup')} style={linkBtn}>
                Create account
              </button>
            </div>
          </div>
        </form>

        {/* ====== FORGOT PASSWORD (right) ====== */}
        <form
          onSubmit={handleForgot}
          className={`auth-form${mode === 'forgot' ? ' active' : ''}`}
          style={{ ...formBase, right: 0, width: '50%', ...vis(mode === 'forgot') }}
        >
          <div style={{ width: '100%', maxWidth: 344 }}>
            <button type="button" className="trk-link" onClick={() => go('login')} style={{ ...linkBtn, fontWeight: 600, color: '#9fb0c7', display: 'flex', alignItems: 'center', gap: 7, marginBottom: 26 }}>
              ← Back to sign in
            </button>
            <div style={heading}>Lost the path?</div>
            {forgotSent ? (
              <div style={{ fontSize: 14.5, color: '#9fb0c7', lineHeight: 1.6 }}>
                We&apos;ve sent a reset link to <strong style={{ color: '#eef3fa' }}>{forgotEmail}</strong>. Check your
                inbox (and spam) for the next step.
              </div>
            ) : (
              <>
                <div style={{ ...subheading, lineHeight: 1.55 }}>
                  Drop your email and we&apos;ll send a link to reset your password and get you back on the trail.
                </div>
                <div style={{ marginBottom: 26 }}>
                  <label style={label}>Email</label>
                  <input
                    className="trk-in"
                    type="email"
                    autoComplete="email"
                    placeholder="you@trail.com"
                    value={forgotEmail}
                    onChange={(e) => { setForgotEmail(e.target.value); clearErr('email'); }}
                    style={input}
                  />
                  {errors.email && <p style={errText}>{errors.email}</p>}
                </div>
                <button type="submit" className="trk-primary" disabled={submitting} style={primaryBtn}>
                  {submitting ? 'Sending…' : 'Send reset link'}
                </button>
              </>
            )}

            <div style={{ marginTop: 24, textAlign: 'center', fontSize: 13.5, color: '#9fb0c7' }}>
              Remembered it?{' '}
              <button type="button" className="trk-link" onClick={() => go('login')} style={linkBtn}>
                Sign in
              </button>
            </div>
          </div>
        </form>

        {/* ====== SIGNUP FORM (left) ====== */}
        <form
          onSubmit={handleSignup}
          className={`auth-form${mode === 'signup' ? ' active' : ''}`}
          style={{ ...formBase, left: 0, width: '50%', ...vis(mode === 'signup') }}
        >
          <div style={{ width: '100%', maxWidth: 344 }}>
            <div style={heading}>Start the climb</div>
            <div style={{ ...subheading, marginBottom: 20 }}>
              {isCompanySignup
                ? 'Create a company account to list and manage your own treks.'
                : 'Create an account and chase the unknown with us.'}
            </div>

            {/* Account kind is permanent — profiles.account_type is pinned by a DB
                trigger once handle_new_user() stamps it, so there is no "switch
                later" path and the choice has to be made honestly up front. */}
            <AccountTypeToggle
              value={signup.accountType}
              onChange={(kind) => { setSignup({ ...signup, accountType: kind }); setErrors({}); }}
              legend="I’m signing up as"
              hint={
                isCompanySignup
                  ? 'You’ll register your company details after verifying your email. Company accounts don’t book treks.'
                  : 'Book treks, join batch chats and track your trail history.'
              }
            />

            <div style={{ marginBottom: 15 }}>
              <label style={label}>{isCompanySignup ? 'Your name' : 'Full name'}</label>
              <input
                className="trk-in"
                type="text"
                autoComplete="name"
                placeholder={isCompanySignup ? 'Maya Rivers (account owner)' : 'Maya Rivers'}
                value={signup.fullName}
                onChange={(e) => { setSignup({ ...signup, fullName: e.target.value }); clearErr('fullName'); }}
                style={input}
              />
              {errors.fullName && <p style={errText}>{errors.fullName}</p>}
            </div>

            <div style={{ marginBottom: 15 }}>
              <label style={label}>Email</label>
              <input
                className="trk-in"
                type="email"
                autoComplete="email"
                placeholder="you@trail.com"
                value={signup.email}
                onChange={(e) => { setSignup({ ...signup, email: e.target.value }); clearErr('email'); }}
                style={input}
              />
              {errors.email && <p style={errText}>{errors.email}</p>}
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={label}>Password</label>
              <div style={{ position: 'relative' }}>
                <input
                  className="trk-in"
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  placeholder="Make it rugged"
                  value={signup.password}
                  onChange={(e) => { setSignup({ ...signup, password: e.target.value }); clearErr('password'); }}
                  style={{ ...input, paddingRight: 44 }}
                />
                <button type="button" className="trk-eye" onClick={() => setShowPw((v) => !v)} style={eyeBtn} aria-label="Toggle password visibility">
                  {showPw ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
              {errors.password && <p style={errText}>{errors.password}</p>}
            </div>

            <label style={{ display: 'flex', alignItems: 'flex-start', gap: 9, fontSize: 13, color: '#9fb0c7', cursor: 'pointer', lineHeight: 1.5, marginBottom: errors.agree ? 8 : 24 }}>
              <input
                type="checkbox"
                checked={signup.agree}
                onChange={(e) => { setSignup({ ...signup, agree: e.target.checked }); clearErr('agree'); }}
                style={{ accentColor: ACCENT, width: 16, height: 16, marginTop: 1, flexShrink: 0 }}
              />
              I agree to wander responsibly — the terms &amp; trail code.
            </label>
            {errors.agree && <p style={{ ...errText, marginTop: 0, marginBottom: 16 }}>{errors.agree}</p>}

            <button type="submit" className="trk-primary" disabled={submitting} style={primaryBtn}>
              {submitting ? 'Creating…' : 'Create account'}
            </button>

            <div style={{ marginTop: 22, textAlign: 'center', fontSize: 13.5, color: '#9fb0c7' }}>
              Already a trekker?{' '}
              <button type="button" className="trk-link" onClick={() => go('login')} style={linkBtn}>
                Sign in
              </button>
            </div>
          </div>
        </form>
      </div>

      <style jsx>{`
        .trk-in::placeholder { color: #6b7a90; }
        .trk-in:focus {
          outline: none;
          border-color: ${ACCENT} !important;
          box-shadow: 0 0 0 3px rgba(96, 165, 250, 0.15) !important;
        }
        .trk-primary:hover:not(:disabled) {
          background: #3b82f6 !important;
          box-shadow: 0 0 30px rgba(37, 99, 235, 0.55) !important;
        }
        .trk-primary:disabled { opacity: 0.7; cursor: default; }
        .trk-link:hover { text-decoration: underline; }
        .trk-cta:hover { background: #e6edf6 !important; color: #0e1626 !important; border-color: #e6edf6 !important; }
        .trk-eye { color: #7e90a8; }
        .trk-eye:hover { color: #eef3fa; }

        @media (max-width: 900px) {
          .auth-card {
            width: 100% !important;
            max-width: 440px !important;
            height: auto !important;
          }
          .auth-cover { display: none !important; }
          .auth-form {
            position: static !important;
            width: 100% !important;
            height: auto !important;
            opacity: 1 !important;
            transform: none !important;
            pointer-events: auto !important;
            display: none !important;
            padding: 40px 28px !important;
          }
          .auth-form.active { display: flex !important; }
        }
      `}</style>
    </div>
  );
}
