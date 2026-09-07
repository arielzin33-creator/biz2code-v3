/* Login and register. */

import { useState, type CSSProperties, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import { ApiError } from '../lib/api';
import { Button } from '../components/ui/Button';
import logo from '../assets/brand/biz2code-logo.png';

export function LoginPage() {
  const { user, restoring, login, register } = useAuth();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'login' | 'register'>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (!restoring && user) return <Navigate to="/projects" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      await (mode === 'login' ? login(email, password) : register(email, password));
      navigate('/projects', { replace: true });
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const label: CSSProperties = {
    display: 'block',
    marginBottom: 6,
    fontFamily: 'var(--font-ui)',
    fontSize: 'var(--text-label-size)',
    fontWeight: 600,
    color: 'var(--text-primary)',
  };

  const field: CSSProperties = {
    width: '100%',
    padding: '13px 14px',
    marginBottom: 16,
    borderRadius: 'var(--radius-control)',
    border: '1.5px solid var(--control-border)',
    background: 'var(--control-bg)',
    color: 'var(--text-primary)',
    fontFamily: 'var(--font-ui)',
    fontSize: 15,
  };

  return (
    <main
      style={{
        minHeight: '100vh',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'var(--surface-page)',
        padding: '24px 20px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 380 }}>
        <img
          src={logo}
          alt="biz2code"
          style={{
            height: 90, width: 'auto', maxWidth: '100%',
            display: 'block', margin: '0 auto 28px',
          }}
        />

        <div
          style={{
            background: 'var(--surface-card)',
            border: '1px solid var(--border-subtle)',
            borderRadius: 'var(--radius-card)',
            boxShadow: 'var(--shadow-hairline)',
            padding: 'var(--card-padding)',
          }}
        >
          <h1
            style={{
              margin: '0 0 4px',
              fontFamily: 'var(--font-display)',
              fontWeight: 800,
              fontSize: 24,
              letterSpacing: '-0.015em',
              color: 'var(--text-primary)',
            }}
          >
            {mode === 'login' ? 'Sign in' : 'Create your account'}
          </h1>
          <p style={{ margin: '0 0 24px', color: 'var(--text-secondary)', fontSize: 13.5, lineHeight: 1.6 }}>
            A linear gatekeeper for business-validated development.
          </p>

          <form onSubmit={submit}>
            <label htmlFor="email" style={label}>Email</label>
            <input
              id="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              style={field}
            />

            <label htmlFor="password" style={label}>Password</label>
            <input
              id="password"
              type="password"
              required
              minLength={8}
              autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              style={field}
            />

            <Button type="submit" disabled={busy} loading={busy} fullWidth style={{ marginTop: 4 }}>
              {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : 'Create account'}
            </Button>
          </form>

          {error && (
            <p
              role="alert"
              style={{
                marginTop: 14,
                marginBottom: 0,
                padding: '10px 13px',
                borderRadius: 'var(--radius-control)',
                background: 'var(--danger-bg)',
                color: 'var(--danger-text)',
                border: '1px solid var(--danger-border)',
                fontSize: 13.5,
              }}
            >
              {error}
            </p>
          )}
        </div>

        <p style={{ marginTop: 20, fontSize: 13.5, color: 'var(--text-secondary)', textAlign: 'center' }}>
          {mode === 'login' ? 'No account yet?' : 'Already registered?'}{' '}
          <button
            type="button"
            onClick={() => { setMode(mode === 'login' ? 'register' : 'login'); setError(null); }}
            style={{
              background: 'none',
              border: 'none',
              color: 'var(--text-link)',
              padding: 0,
              fontSize: 13.5,
              fontWeight: 600,
              textDecoration: 'underline',
            }}
          >
            {mode === 'login' ? 'Create one' : 'Sign in'}
          </button>
        </p>
      </div>
    </main>
  );
}
