import React, { useMemo, useState } from 'react';
import { useAuth } from '../context/AuthContext.jsx';

const ADMIN_OPTIONS = [
  {
    id: 'telegram',
    title: 'Telegram Admin Access',
    description: 'Secure invite + OTP handshake for privileged access.',
    actionLabel: 'Request via Telegram',
    hint: 'telegram://resolve?domain=your_admin_support',
  },
  {
    id: 'email',
    title: 'Email Admin Access',
    description: 'Verified email login with device approval.',
    actionLabel: 'Request via Email',
    hint: 'mailto:admin@yourdomain.com',
  },
];

const DEFAULT_BRAND = {
  name: 'Neon Intelligence Console',
  tagline: 'Secure Operations & Smart Signal Oversight',
};

export default function LoginPanel({ brand = DEFAULT_BRAND, onDemoLogin }) {
  const { login, completeMfa, status, mfaState } = useAuth();
  const [credentials, setCredentials] = useState({ username: '', password: '' });
  const [mfaCode, setMfaCode] = useState('');

  const isLoading = status?.loading;
  const error = status?.error;
  const loginDisabled = isLoading || !credentials.username || !credentials.password;
  const mfaDisabled = isLoading || !mfaCode;

  const hero = useMemo(
    () => ({
      title: brand?.name || DEFAULT_BRAND.name,
      subtitle: brand?.tagline || DEFAULT_BRAND.tagline,
    }),
    [brand]
  );

  const handleLogin = async (event) => {
    event.preventDefault();
    if (loginDisabled) {
      return;
    }
    await login(credentials);
  };

  const handleMfa = async (event) => {
    event.preventDefault();
    if (mfaDisabled) {
      return;
    }
    await completeMfa(mfaCode);
  };

  return (
    <section className="auth-panel">
      <div className="auth-panel__card">
        <div className="auth-panel__brand">
          <div className="auth-panel__logo">
            <span className="auth-panel__logo-orb" />
            <span className="auth-panel__logo-text">NEON</span>
          </div>
          <div>
            <h1 className="auth-panel__title">{hero.title}</h1>
            <p className="auth-panel__subtitle">{hero.subtitle}</p>
          </div>
        </div>

        {mfaState ? (
          <form className="auth-panel__form" onSubmit={handleMfa}>
            <h2 className="auth-panel__section-title">Multi-Factor Verification</h2>
            <p className="auth-panel__helper">
              Enter the 6-digit code from your authenticator app.
            </p>
            <input
              className="auth-panel__input"
              type="text"
              placeholder="MFA Code"
              autoComplete="one-time-code"
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
            />
            {error && <div className="auth-panel__error">{error}</div>}
            <button className="auth-panel__button" type="submit" disabled={mfaDisabled}>
              {isLoading ? 'Verifying…' : 'Verify & Enter'}
            </button>
          </form>
        ) : (
          <form className="auth-panel__form" onSubmit={handleLogin}>
            <h2 className="auth-panel__section-title">Admin Login</h2>
            <input
              className="auth-panel__input"
              type="text"
              placeholder="Username"
              autoComplete="username"
              value={credentials.username}
              onChange={(event) =>
                setCredentials((prev) => ({ ...prev, username: event.target.value }))
              }
            />
            <input
              className="auth-panel__input"
              type="password"
              placeholder="Password"
              autoComplete="current-password"
              value={credentials.password}
              onChange={(event) =>
                setCredentials((prev) => ({ ...prev, password: event.target.value }))
              }
            />
            {error && <div className="auth-panel__error">{error}</div>}
            <button className="auth-panel__button" type="submit" disabled={loginDisabled}>
              {isLoading ? 'Signing in…' : 'Secure Sign In'}
            </button>
            {onDemoLogin && (
              <button
                type="button"
                className="auth-panel__button auth-panel__button--ghost"
                onClick={onDemoLogin}
              >
                Quick Demo Access
              </button>
            )}
          </form>
        )}
      </div>

      <div className="auth-panel__options">
        {ADMIN_OPTIONS.map((option) => (
          <article key={option.id} className="auth-panel__option">
            <h3>{option.title}</h3>
            <p>{option.description}</p>
            <a className="auth-panel__link" href={option.hint}>
              {option.actionLabel}
            </a>
          </article>
        ))}
      </div>
    </section>
  );
}
