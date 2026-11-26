'use client';

import React, { useState } from 'react';
import { api } from '../services/api';
import type { User, UserRole } from '../types';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  currentUser: User | null;
  onAuthSuccess: (user: User) => void;
  onLogout: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  currentUser,
  onAuthSuccess,
  onLogout,
}) => {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('Password123!');
  const [mfaToken, setMfaToken] = useState<string | null>(null);
  const [mfaCode, setMfaCode] = useState('123456');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mfaSetupData, setMfaSetupData] = useState<{
    secret: string;
    backupCodes: string[];
    demoCode: string;
  } | null>(null);

  if (!isOpen) return null;

  const quickRoles: Array<{ role: UserRole; email: string; label: string; icon: string }> = [
    { role: 'customer', email: 'alex.morgan@example.com', label: 'Customer', icon: '👤' },
    {
      role: 'support_agent',
      email: 'support@fincore.internal',
      label: 'Support Agent',
      icon: '🎧',
    },
    {
      role: 'operations_analyst',
      email: 'sam.ops@example.com',
      label: 'Operations Analyst',
      icon: '🛡️',
    },
    {
      role: 'finance_administrator',
      email: 'finance.admin@fincore.internal',
      label: 'Finance Admin',
      icon: '💼',
    },
    {
      role: 'platform_administrator',
      email: 'platform.admin@fincore.internal',
      label: 'Platform Admin',
      icon: '⚡',
    },
  ];

  const handleQuickSelect = (selectedEmail: string) => {
    setEmail(selectedEmail);
    setPassword('Password123!');
    setError(null);
  };

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const res = await api.login(email, password);

      if (res.mfaRequired && res.mfaToken) {
        setMfaToken(res.mfaToken);
        setMfaCode('123456');
      } else if (res.user) {
        onAuthSuccess(res.user);
        onClose();
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Authentication failed');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!mfaToken) return;

    setLoading(true);
    setError(null);

    try {
      const res = await api.mfaChallenge(mfaToken, mfaCode);
      onAuthSuccess(res.user);
      setMfaToken(null);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Invalid MFA verification code');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaSetup = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.mfaSetup();
      setMfaSetupData(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to setup MFA');
    } finally {
      setLoading(false);
    }
  };

  const handleMfaVerifyAndActivate = async () => {
    setLoading(true);
    setError(null);
    try {
      await api.mfaVerify('123456');
      alert('Two-factor authentication successfully enabled for this account!');
      setMfaSetupData(null);
      const me = await api.getMe();
      onAuthSuccess(me.user);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'MFA verification failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        backgroundColor: 'rgba(15, 23, 42, 0.6)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
        padding: '1rem',
      }}
      role="dialog"
      aria-modal="true"
      aria-labelledby="auth-modal-title"
    >
      <div
        style={{
          backgroundColor: '#ffffff',
          borderRadius: 'var(--radius-lg, 0.75rem)',
          maxWidth: '520px',
          width: '100%',
          padding: '1.75rem',
          boxShadow: 'var(--shadow-xl)',
          maxHeight: '90vh',
          overflowY: 'auto',
        }}
      >
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            marginBottom: '1.25rem',
          }}
        >
          <div>
            <h3
              id="auth-modal-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, margin: 0, color: 'var(--gray-900)' }}
            >
              🔐 Financial Identity & Authorization
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', margin: '0.25rem 0 0 0' }}>
              RBAC, JWT Session & MFA Verification
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{
              border: 'none',
              background: 'transparent',
              fontSize: '1.25rem',
              cursor: 'pointer',
              color: 'var(--gray-400)',
            }}
          >
            ✕
          </button>
        </div>

        {error && (
          <div
            style={{
              padding: '0.75rem',
              borderRadius: 'var(--radius-md, 0.375rem)',
              backgroundColor: '#fee2e2',
              color: '#991b1b',
              fontSize: '0.8125rem',
              marginBottom: '1rem',
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {currentUser && !mfaToken ? (
          <div>
            <div
              style={{
                padding: '1rem',
                backgroundColor: 'var(--gray-50)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--gray-200)',
                marginBottom: '1rem',
              }}
            >
              <div
                style={{ fontSize: '0.8125rem', color: 'var(--gray-500)', marginBottom: '0.25rem' }}
              >
                Authenticated Persona:
              </div>
              <div style={{ fontWeight: 600, fontSize: '1rem', color: 'var(--gray-900)' }}>
                {currentUser.fullName || currentUser.email}
              </div>
              <div
                style={{ display: 'flex', gap: '0.5rem', marginTop: '0.5rem', flexWrap: 'wrap' }}
              >
                <span
                  style={{
                    padding: '0.2rem 0.5rem',
                    borderRadius: '9999px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    backgroundColor: '#e0e7ff',
                    color: '#3730a3',
                    textTransform: 'uppercase',
                  }}
                >
                  Role: {currentUser.role}
                </span>
                <span
                  style={{
                    padding: '0.2rem 0.5rem',
                    borderRadius: '9999px',
                    fontSize: '0.75rem',
                    fontWeight: 600,
                    backgroundColor: currentUser.mfaEnabled ? '#dcfce7' : '#fef3c7',
                    color: currentUser.mfaEnabled ? '#166534' : '#92400e',
                  }}
                >
                  {currentUser.mfaEnabled ? '🛡️ MFA Enabled' : '⚠️ MFA Disabled'}
                </span>
              </div>
            </div>

            {/* MFA Setup Section */}
            {!currentUser.mfaEnabled && (
              <div style={{ marginBottom: '1.25rem' }}>
                {!mfaSetupData ? (
                  <button
                    type="button"
                    onClick={handleMfaSetup}
                    disabled={loading}
                    style={{
                      width: '100%',
                      padding: '0.625rem',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid var(--primary)',
                      backgroundColor: '#eff6ff',
                      color: 'var(--primary)',
                      fontWeight: 600,
                      cursor: 'pointer',
                      fontSize: '0.875rem',
                    }}
                  >
                    ⚙️ Enable Two-Factor Authentication (MFA)
                  </button>
                ) : (
                  <div
                    style={{
                      padding: '1rem',
                      backgroundColor: '#eff6ff',
                      borderRadius: 'var(--radius-md)',
                      border: '1px solid #bfdbfe',
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 600,
                        fontSize: '0.875rem',
                        marginBottom: '0.5rem',
                        color: '#1e40af',
                      }}
                    >
                      MFA Simulator Ready
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--gray-600)',
                        marginBottom: '0.5rem',
                      }}
                    >
                      Secret: <code>{mfaSetupData.secret}</code>
                    </div>
                    <div
                      style={{
                        fontSize: '0.75rem',
                        color: 'var(--gray-600)',
                        marginBottom: '0.75rem',
                      }}
                    >
                      Backup Codes: {mfaSetupData.backupCodes.join(', ')}
                    </div>
                    <button
                      type="button"
                      onClick={handleMfaVerifyAndActivate}
                      disabled={loading}
                      style={{
                        width: '100%',
                        padding: '0.5rem',
                        borderRadius: 'var(--radius-md)',
                        backgroundColor: '#2563eb',
                        color: '#ffffff',
                        fontWeight: 600,
                        border: 'none',
                        cursor: 'pointer',
                        fontSize: '0.8125rem',
                      }}
                    >
                      Confirm with Demo Code (123456)
                    </button>
                  </div>
                )}
              </div>
            )}

            <button
              type="button"
              onClick={() => {
                onLogout();
                onClose();
              }}
              style={{
                width: '100%',
                padding: '0.625rem',
                borderRadius: 'var(--radius-md)',
                backgroundColor: '#dc2626',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              🚪 Sign Out & Revoke Session
            </button>
          </div>
        ) : mfaToken ? (
          /* MFA Challenge Form */
          <form onSubmit={handleMfaSubmit}>
            <div style={{ marginBottom: '1rem', textAlign: 'center' }}>
              <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>🛡️</div>
              <h4 style={{ margin: '0 0 0.5rem 0', fontWeight: 600 }}>Two-Factor Authentication</h4>
              <p style={{ fontSize: '0.8125rem', color: 'var(--gray-600)', margin: 0 }}>
                Enter your 6-digit TOTP verification code or emergency backup code.
              </p>
            </div>

            <div style={{ marginBottom: '1.25rem' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.8125rem',
                  fontWeight: 600,
                  marginBottom: '0.375rem',
                }}
              >
                Verification Code
              </label>
              <input
                type="text"
                value={mfaCode}
                onChange={e => setMfaCode(e.target.value)}
                placeholder="123456"
                style={{
                  width: '100%',
                  padding: '0.625rem',
                  fontSize: '1.25rem',
                  textAlign: 'center',
                  letterSpacing: '0.25rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--gray-300)',
                }}
                required
              />
              <span
                style={{
                  fontSize: '0.75rem',
                  color: 'var(--gray-500)',
                  marginTop: '0.25rem',
                  display: 'block',
                }}
              >
                💡 Simulation hint: Demo code is <code>123456</code>.
              </span>
            </div>

            <button
              type="submit"
              disabled={loading}
              style={{
                width: '100%',
                padding: '0.625rem',
                borderRadius: 'var(--radius-md)',
                backgroundColor: 'var(--primary)',
                color: '#ffffff',
                border: 'none',
                fontWeight: 600,
                cursor: 'pointer',
                fontSize: '0.875rem',
              }}
            >
              {loading ? 'Verifying...' : 'Verify MFA Code'}
            </button>
          </form>
        ) : (
          /* Standard Login Form */
          <div>
            <div style={{ marginBottom: '1.25rem' }}>
              <label
                style={{
                  display: 'block',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  color: 'var(--gray-500)',
                  marginBottom: '0.5rem',
                  textTransform: 'uppercase',
                }}
              >
                Quick Persona Switcher:
              </label>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))',
                  gap: '0.5rem',
                }}
              >
                {quickRoles.map(q => (
                  <button
                    key={q.role}
                    type="button"
                    onClick={() => handleQuickSelect(q.email)}
                    style={{
                      padding: '0.5rem',
                      borderRadius: 'var(--radius-md)',
                      border:
                        email === q.email
                          ? '2px solid var(--primary)'
                          : '1px solid var(--gray-200)',
                      backgroundColor: email === q.email ? '#e0e7ff' : '#ffffff',
                      color: email === q.email ? 'var(--primary)' : 'var(--gray-800)',
                      cursor: 'pointer',
                      fontSize: '0.75rem',
                      fontWeight: 600,
                      textAlign: 'left',
                    }}
                  >
                    {q.icon} {q.label}
                  </button>
                ))}
              </div>
            </div>

            <form onSubmit={handleLogin}>
              <div style={{ marginBottom: '1rem' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    marginBottom: '0.375rem',
                  }}
                >
                  Email Address
                </label>
                <input
                  type="email"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  placeholder="user@fincore.internal"
                  style={{
                    width: '100%',
                    padding: '0.625rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--gray-300)',
                    fontSize: '0.875rem',
                  }}
                  required
                />
              </div>

              <div style={{ marginBottom: '1.25rem' }}>
                <label
                  style={{
                    display: 'block',
                    fontSize: '0.8125rem',
                    fontWeight: 600,
                    marginBottom: '0.375rem',
                  }}
                >
                  Password
                </label>
                <input
                  type="password"
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  style={{
                    width: '100%',
                    padding: '0.625rem',
                    borderRadius: 'var(--radius-md)',
                    border: '1px solid var(--gray-300)',
                    fontSize: '0.875rem',
                  }}
                  required
                />
              </div>

              <button
                type="submit"
                disabled={loading}
                style={{
                  width: '100%',
                  padding: '0.625rem',
                  borderRadius: 'var(--radius-md)',
                  backgroundColor: 'var(--primary)',
                  color: '#ffffff',
                  border: 'none',
                  fontWeight: 600,
                  cursor: 'pointer',
                  fontSize: '0.875rem',
                }}
              >
                {loading ? 'Authenticating...' : 'Sign In with JWT'}
              </button>
            </form>
          </div>
        )}
      </div>
    </div>
  );
};
