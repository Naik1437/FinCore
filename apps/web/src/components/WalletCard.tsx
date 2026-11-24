import React from 'react';
import type { Wallet } from '../types';

interface WalletCardProps {
  wallet: Wallet;
  onSendTransfer: (walletId: string) => void;
  onViewStatement: (walletId: string) => void;
}

export const WalletCard: React.FC<WalletCardProps> = ({
  wallet,
  onSendTransfer,
  onViewStatement,
}) => {
  const currencySymbols: Record<string, string> = {
    USD: '$',
    EUR: '€',
    GBP: '£',
  };

  const symbol = currencySymbols[wallet.currency] || wallet.currency;

  return (
    <article
      className="card"
      style={{
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'space-between',
        position: 'relative',
        overflow: 'hidden',
        borderLeft: '4px solid var(--primary)',
      }}
      aria-labelledby={`wallet-heading-${wallet.id}`}
    >
      <div>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'flex-start',
            marginBottom: '0.75rem',
          }}
        >
          <div>
            <span
              id={`wallet-heading-${wallet.id}`}
              style={{
                fontSize: '0.875rem',
                fontWeight: 600,
                color: 'var(--gray-600)',
                textTransform: 'uppercase',
                letterSpacing: '0.05em',
              }}
            >
              {wallet.currency} Wallet
            </span>
            <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.125rem' }}>
              ID:{' '}
              <code>
                {wallet.id.slice(0, 8)}...{wallet.id.slice(-4)}
              </code>
            </div>
          </div>
          <span
            className={`status-badge status-${wallet.status}`}
            aria-label={`Status: ${wallet.status}`}
          >
            ● {wallet.status}
          </span>
        </div>

        {/* Balance section */}
        <div style={{ margin: '1rem 0' }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
              marginBottom: '0.25rem',
            }}
          >
            <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 500 }}>
              AVAILABLE SIMULATED BALANCE
            </span>
            <span
              className="simulated-badge"
              style={{ fontSize: '0.65rem', padding: '0.15rem 0.4rem' }}
            >
              Simulated
            </span>
          </div>
          <div
            style={{
              fontSize: '2rem',
              fontWeight: 700,
              color: 'var(--gray-900)',
              letterSpacing: '-0.03em',
            }}
          >
            {symbol}
            {wallet.balance.toLocaleString('en-US', {
              minimumFractionDigits: 2,
              maximumFractionDigits: 2,
            })}
            <span
              style={{
                fontSize: '1rem',
                fontWeight: 500,
                color: 'var(--gray-500)',
                marginLeft: '0.375rem',
              }}
            >
              {wallet.currency}
            </span>
          </div>
          <div
            style={{
              fontSize: '0.75rem',
              color: '#92400e',
              backgroundColor: '#fffbeb',
              padding: '0.25rem 0.5rem',
              borderRadius: 'var(--radius-sm)',
              marginTop: '0.5rem',
              border: '1px solid #fef3c7',
            }}
          >
            ℹ️ Test funds only — zero real cash liability
          </div>
        </div>
      </div>

      {/* Actions */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          paddingTop: '1rem',
          borderTop: '1px solid var(--gray-100)',
          marginTop: '0.5rem',
        }}
      >
        <button
          type="button"
          className="btn-primary btn-sm"
          onClick={() => onSendTransfer(wallet.id)}
          style={{ flex: 1 }}
        >
          💸 Send Funds
        </button>
        <button
          type="button"
          className="btn-secondary btn-sm"
          onClick={() => onViewStatement(wallet.id)}
          style={{ flex: 1 }}
        >
          📄 Statement
        </button>
      </div>
    </article>
  );
};
