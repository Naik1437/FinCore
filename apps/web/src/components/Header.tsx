import React from 'react';

interface HeaderProps {
  currentRole: 'customer' | 'operations';
  onRoleChange: (role: 'customer' | 'operations') => void;
  activeTab: string;
  onTabChange: (tab: string) => void;
  currentUser?: { email: string; role: string; fullName?: string; mfaEnabled?: boolean } | null;
  onOpenAuth?: () => void;
}

export const Header: React.FC<HeaderProps> = ({
  currentRole,
  onRoleChange,
  activeTab,
  onTabChange,
  currentUser,
  onOpenAuth,
}) => {
  return (
    <header
      style={{
        backgroundColor: '#ffffff',
        borderBottom: '1px solid var(--gray-200)',
        boxShadow: 'var(--shadow-sm)',
        position: 'sticky',
        top: 0,
        zIndex: 40,
      }}
    >
      <div
        style={{
          maxWidth: '1280px',
          margin: '0 auto',
          padding: '0.75rem 1.5rem',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: '1rem',
        }}
      >
        {/* Brand */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
          <div
            style={{
              width: '36px',
              height: '36px',
              borderRadius: '0.5rem',
              background: 'linear-gradient(135deg, #4f46e5 0%, #7c3aed 100%)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              color: '#ffffff',
              fontWeight: 700,
              fontSize: '1.25rem',
            }}
          >
            F
          </div>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
              <span
                style={{
                  fontSize: '1.25rem',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: 'var(--gray-900)',
                }}
              >
                FinCore
              </span>
              <span className="simulated-badge">Simulated</span>
            </div>
            <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
              Digital Wallet & Ledger Platform
            </span>
          </div>
        </div>

        {/* Role Switcher & Navigation */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          {/* Role selector */}
          <div
            style={{
              display: 'flex',
              backgroundColor: 'var(--gray-100)',
              padding: '0.25rem',
              borderRadius: 'var(--radius-md)',
              border: '1px solid var(--gray-300)',
            }}
            role="radiogroup"
            aria-label="User Persona Selector"
          >
            <button
              type="button"
              role="radio"
              aria-checked={currentRole === 'customer'}
              onClick={() => onRoleChange('customer')}
              style={{
                padding: '0.375rem 0.875rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                fontWeight: currentRole === 'customer' ? 600 : 500,
                backgroundColor: currentRole === 'customer' ? '#ffffff' : 'transparent',
                color: currentRole === 'customer' ? 'var(--primary)' : 'var(--gray-600)',
                boxShadow: currentRole === 'customer' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              👤 Customer View
            </button>
            <button
              type="button"
              role="radio"
              aria-checked={currentRole === 'operations'}
              onClick={() => onRoleChange('operations')}
              style={{
                padding: '0.375rem 0.875rem',
                borderRadius: 'var(--radius-sm)',
                fontSize: '0.8125rem',
                fontWeight: currentRole === 'operations' ? 600 : 500,
                backgroundColor: currentRole === 'operations' ? '#ffffff' : 'transparent',
                color: currentRole === 'operations' ? 'var(--primary)' : 'var(--gray-600)',
                boxShadow: currentRole === 'operations' ? 'var(--shadow-sm)' : 'none',
              }}
            >
              🛡️ Operations Console
            </button>
          </div>

          {/* User profile indicator */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              fontSize: '0.8125rem',
              color: 'var(--gray-600)',
              borderLeft: '1px solid var(--gray-200)',
              paddingLeft: '1rem',
            }}
          >
            <span
              style={{
                width: '28px',
                height: '28px',
                borderRadius: '50%',
                backgroundColor: currentRole === 'customer' ? '#e0e7ff' : '#fee2e2',
                color: currentRole === 'customer' ? '#3730a3' : '#991b1b',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontWeight: 600,
              }}
            >
              {currentRole === 'customer' ? 'AM' : 'SR'}
            </span>
            <div className="hide-on-mobile">
              <span style={{ fontWeight: 600, color: 'var(--gray-900)' }}>
                {currentUser?.fullName ||
                  (currentRole === 'customer' ? 'Alex Morgan' : 'Sam Rivera')}
              </span>
              <div style={{ fontSize: '0.7rem', color: 'var(--gray-500)' }}>
                {currentUser
                  ? `Role: ${currentUser.role}`
                  : currentRole === 'customer'
                    ? 'Simulated Customer'
                    : 'Risk & Operations Analyst'}
                {currentUser?.mfaEnabled && ' • 🛡️ MFA'}
              </div>
            </div>
            {onOpenAuth && (
              <button
                type="button"
                onClick={onOpenAuth}
                style={{
                  padding: '0.375rem 0.625rem',
                  borderRadius: 'var(--radius-sm)',
                  border: '1px solid var(--gray-300)',
                  backgroundColor: '#ffffff',
                  color: 'var(--gray-700)',
                  fontSize: '0.75rem',
                  fontWeight: 600,
                  cursor: 'pointer',
                  marginLeft: '0.5rem',
                }}
              >
                🔐 {currentUser ? 'Switch Role' : 'Sign In'}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Navigation tabs for Customer view */}
      {currentRole === 'customer' && (
        <nav
          aria-label="Customer Navigation"
          style={{
            maxWidth: '1280px',
            margin: '0 auto',
            padding: '0 1.5rem',
            display: 'flex',
            gap: '1.5rem',
            overflowX: 'auto',
          }}
        >
          {[
            { id: 'overview', label: '📊 Overview & Wallets' },
            { id: 'transfers', label: '💸 Send Funds' },
            { id: 'transactions', label: '📜 History & Transactions' },
            { id: 'beneficiaries', label: '👥 Beneficiaries' },
            { id: 'disputes', label: '⚖️ Disputes' },
            { id: 'statements', label: '📄 Statements & Reports' },
          ].map(tab => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onTabChange(tab.id)}
              style={{
                padding: '0.75rem 0.25rem',
                fontSize: '0.875rem',
                fontWeight: activeTab === tab.id ? 600 : 500,
                color: activeTab === tab.id ? 'var(--primary)' : 'var(--gray-600)',
                borderBottom:
                  activeTab === tab.id ? '2px solid var(--primary)' : '2px solid transparent',
                whiteSpace: 'nowrap',
              }}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      )}
    </header>
  );
};
