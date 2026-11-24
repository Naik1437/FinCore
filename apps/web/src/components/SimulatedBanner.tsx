import React from 'react';

export const SimulatedBanner: React.FC = () => {
  return (
    <aside
      aria-label="Simulation Environment Notice"
      style={{
        backgroundColor: '#fffbeb',
        borderBottom: '1px solid #fde68a',
        padding: '0.625rem 1.25rem',
        fontSize: '0.8125rem',
        color: '#92400e',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: '0.5rem',
        textAlign: 'center',
        fontWeight: 500,
      }}
    >
      <span aria-hidden="true" style={{ fontSize: '1rem' }}>
        ⚠️
      </span>
      <span>
        <strong>SIMULATED FINANCIAL ENVIRONMENT:</strong> All wallet balances, accounts,
        beneficiaries, and transactions are synthetic records for demonstration. No real funds or
        banking credentials are used.
      </span>
    </aside>
  );
};
