import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Statement, Wallet } from '../types';

interface StatementViewerProps {
  wallets: Wallet[];
  selectedWalletId?: string;
}

export const StatementViewer: React.FC<StatementViewerProps> = ({ wallets, selectedWalletId }) => {
  const [walletId, setWalletId] = useState<string>(
    selectedWalletId || (wallets.length > 0 ? wallets[0].id : '')
  );
  const [statement, setStatement] = useState<Statement | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (walletId) {
      loadStatement(walletId);
    }
  }, [walletId]);

  const loadStatement = async (id: string) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getStatement(id);
      setStatement(data);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load statement');
    } finally {
      setLoading(false);
    }
  };

  const exportJSON = () => {
    if (!statement) return;
    const blob = new Blob([JSON.stringify(statement, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${statement.statementId}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const exportCSV = () => {
    if (!statement) return;
    const headers = 'ID,Date,Type,Amount,Currency,Status,Description\n';
    const rows = statement.transactions
      .map(
        t =>
          `"${t.id}","${t.createdAt}","${t.type}",${t.amount},"${t.currency}","${t.status}","${(t.description || '').replace(/"/g, '""')}"`
      )
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${statement.statementId}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section aria-labelledby="statement-title" style={{ marginTop: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.25rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <h2
            id="statement-title"
            style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gray-900)' }}
          >
            Financial Reports & Statements
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
            View periodic account statements, calculated net cash flows, and export reports.
          </p>
        </div>

        <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
          <select
            value={walletId}
            onChange={e => setWalletId(e.target.value)}
            style={{ minWidth: '180px' }}
            aria-label="Select wallet for statement"
          >
            {wallets.map(w => (
              <option key={w.id} value={w.id}>
                {w.currency} Wallet ({w.currency} {w.balance.toFixed(2)})
              </option>
            ))}
          </select>

          {statement && (
            <div style={{ display: 'flex', gap: '0.5rem' }}>
              <button type="button" className="btn-secondary btn-sm" onClick={exportCSV}>
                📥 Export CSV
              </button>
              <button type="button" className="btn-secondary btn-sm" onClick={exportJSON}>
                📥 Export JSON
              </button>
            </div>
          )}
        </div>
      </div>

      {error && (
        <div
          style={{
            backgroundColor: 'var(--danger-light)',
            color: 'var(--danger)',
            padding: '0.875rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1rem',
            border: '1px solid #fecaca',
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {loading ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}
        >
          Generating statement from ledger records...
        </div>
      ) : !statement ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '2rem', color: 'var(--gray-500)' }}
        >
          No statement data available.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1.5rem' }}>
          {/* Statement Header Card */}
          <div className="card" style={{ borderTop: '4px solid var(--primary)' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'flex-start',
                flexWrap: 'wrap',
                gap: '1rem',
                borderBottom: '1px solid var(--gray-200)',
                paddingBottom: '1rem',
                marginBottom: '1rem',
              }}
            >
              <div>
                <span className="simulated-badge" style={{ marginBottom: '0.5rem' }}>
                  Simulated Statement
                </span>
                <h3 style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                  Account Statement — {statement.wallet.currency}
                </h3>
                <div
                  style={{ fontSize: '0.8125rem', color: 'var(--gray-600)', marginTop: '0.25rem' }}
                >
                  Statement ID: <code>{statement.statementId}</code>
                </div>
              </div>
              <div style={{ textAlign: 'right', fontSize: '0.8125rem', color: 'var(--gray-600)' }}>
                <div>
                  <strong>Generated:</strong> {new Date(statement.generatedAt).toLocaleString()}
                </div>
                <div>
                  <strong>Period:</strong> Last 30 Days
                </div>
              </div>
            </div>

            {/* Financial Summary Grid */}
            <div className="grid-cols-auto" style={{ marginTop: '1rem' }}>
              <div
                style={{
                  backgroundColor: 'var(--gray-50)',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--gray-200)',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 600 }}>
                  TOTAL CREDITS (IN)
                </span>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: 'var(--success)',
                    marginTop: '0.25rem',
                  }}
                >
                  +{statement.wallet.currency} {statement.summary.totalCredits.toFixed(2)}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--gray-50)',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--gray-200)',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 600 }}>
                  TOTAL DEBITS (OUT)
                </span>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: 'var(--danger)',
                    marginTop: '0.25rem',
                  }}
                >
                  -{statement.wallet.currency} {statement.summary.totalDebits.toFixed(2)}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: 'var(--gray-50)',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--gray-200)',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: 'var(--gray-500)', fontWeight: 600 }}>
                  NET CASH FLOW
                </span>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: statement.summary.netFlow >= 0 ? 'var(--success)' : 'var(--danger)',
                    marginTop: '0.25rem',
                  }}
                >
                  {statement.summary.netFlow >= 0 ? '+' : ''}
                  {statement.wallet.currency} {statement.summary.netFlow.toFixed(2)}
                </div>
              </div>

              <div
                style={{
                  backgroundColor: '#f0fdf4',
                  padding: '1rem',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid #bbf7d0',
                }}
              >
                <span style={{ fontSize: '0.75rem', color: '#166534', fontWeight: 600 }}>
                  CURRENT BALANCE
                </span>
                <div
                  style={{
                    fontSize: '1.25rem',
                    fontWeight: 700,
                    color: '#166534',
                    marginTop: '0.25rem',
                  }}
                >
                  {statement.wallet.currency} {statement.wallet.currentBalance.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          {/* Statement Line Items Table */}
          <div className="table-container">
            <table aria-label="Statement Line Items">
              <thead>
                <tr>
                  <th scope="col">Date</th>
                  <th scope="col">Type</th>
                  <th scope="col">Description</th>
                  <th scope="col">Status</th>
                  <th scope="col" style={{ textAlign: 'right' }}>
                    Amount
                  </th>
                </tr>
              </thead>
              <tbody>
                {statement.transactions.map(item => {
                  const isDebit = item.type !== 'deposit';
                  return (
                    <tr key={item.id}>
                      <td
                        style={{
                          whiteSpace: 'nowrap',
                          fontSize: '0.8125rem',
                          color: 'var(--gray-600)',
                        }}
                      >
                        {new Date(item.createdAt).toLocaleDateString()}
                      </td>
                      <td style={{ textTransform: 'capitalize', fontWeight: 500 }}>{item.type}</td>
                      <td>{item.description || 'Simulated transaction'}</td>
                      <td>
                        <span className={`status-badge status-${item.status}`}>
                          ● {item.status}
                        </span>
                      </td>
                      <td
                        style={{
                          textAlign: 'right',
                          fontWeight: 600,
                          color: isDebit ? 'var(--gray-900)' : 'var(--success)',
                        }}
                      >
                        {isDebit ? '-' : '+'}
                        {item.currency} {item.amount.toFixed(2)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </section>
  );
};
