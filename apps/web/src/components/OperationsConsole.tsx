'use client';

import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Dispute, DisputeStatus, LedgerEntry, OperationsSummary, Transaction } from '../types';

interface OperationsConsoleProps {
  onRefreshNeeded?: () => void;
}

export function OperationsConsole({ onRefreshNeeded }: OperationsConsoleProps) {
  const [summary, setSummary] = useState<OperationsSummary | null>(null);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [ledgerEntries, setLedgerEntries] = useState<LedgerEntry[]>([]);
  const [activeTab, setActiveTab] = useState<'overview' | 'disputes' | 'transactions' | 'ledger'>(
    'overview'
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Dispute resolution state
  const [selectedDispute, setSelectedDispute] = useState<Dispute | null>(null);
  const [resolutionStatus, setResolutionStatus] = useState<DisputeStatus>('under_investigation');
  const [resolutionNotes, setResolutionNotes] = useState('');
  const [resolving, setResolving] = useState(false);
  const [actionSuccess, setActionSuccess] = useState<string | null>(null);

  const loadData = async () => {
    if (loading && summary) return;
    setLoading(true);
    setError(null);
    try {
      const [sumData, dispData, txData, ledgData] = await Promise.all([
        api.getOperationsSummary(),
        api.getDisputes(),
        api.getTransactions(),
        api.getLedgerEntries(),
      ]);

      setSummary(sumData);
      setDisputes(dispData);
      setTransactions(txData);
      setLedgerEntries(ledgData);
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load operations data.');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleResolveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedDispute) return;
    if (!resolutionNotes.trim()) {
      setError('Please provide investigation/resolution notes.');
      return;
    }

    setResolving(true);
    try {
      await api.updateDisputeStatus(selectedDispute.id, resolutionStatus, resolutionNotes);
      setActionSuccess(
        `Dispute ${selectedDispute.id.slice(0, 8)} status updated to ${resolutionStatus.replace('_', ' ')}`
      );
      setSelectedDispute(null);
      setResolutionNotes('');
      await loadData();
      if (onRefreshNeeded) onRefreshNeeded();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to update dispute.');
    } finally {
      setResolving(false);
    }
  };

  const openDisputeCount = disputes.filter(
    d => d.status === 'pending_review' || d.status === 'under_investigation'
  ).length;

  return (
    <div className="card" style={{ marginTop: '1rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1.25rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '1rem',
        }}
      >
        <div>
          <h2
            style={{
              fontSize: '1.35rem',
              fontWeight: 700,
              margin: 0,
              display: 'flex',
              alignItems: 'center',
              gap: '0.5rem',
            }}
          >
            <span>🛠️ Operations Command Console</span>
            <span className="simulated-badge">Internal Staff Only</span>
          </h2>
          <p style={{ margin: '0.25rem 0 0 0', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Real-time operational metrics, compliance dispute resolution, and ledger audit
            verification.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          onClick={loadData}
          disabled={loading}
          style={{ fontSize: '0.85rem' }}
        >
          🔄 Refresh Feeds
        </button>
      </div>

      {actionSuccess && (
        <div
          style={{
            background: '#ecfdf5',
            border: '1px solid #10b981',
            borderRadius: '8px',
            padding: '0.75rem',
            marginBottom: '1rem',
            color: '#065f46',
            fontSize: '0.9rem',
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
          }}
        >
          <span>✅ {actionSuccess}</span>
          <button
            onClick={() => setActionSuccess(null)}
            style={{
              background: 'none',
              border: 'none',
              color: '#065f46',
              cursor: 'pointer',
              fontWeight: 700,
            }}
          >
            ✕
          </button>
        </div>
      )}

      {error && (
        <div
          style={{
            background: '#fef2f2',
            border: '1px solid #ef4444',
            borderRadius: '8px',
            padding: '0.75rem',
            marginBottom: '1rem',
            color: '#991b1b',
            fontSize: '0.9rem',
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Tabs */}
      <div
        style={{
          display: 'flex',
          gap: '0.5rem',
          borderBottom: '1px solid var(--border)',
          paddingBottom: '0.5rem',
          marginBottom: '1.25rem',
        }}
      >
        <button
          className={`btn ${activeTab === 'overview' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('overview')}
          style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
        >
          📊 System Metrics
        </button>
        <button
          className={`btn ${activeTab === 'disputes' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('disputes')}
          style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
        >
          ⚖️ Dispute Escalations ({openDisputeCount})
        </button>
        <button
          className={`btn ${activeTab === 'transactions' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('transactions')}
          style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
        >
          💳 Global Transactions ({transactions.length})
        </button>
        <button
          className={`btn ${activeTab === 'ledger' ? 'btn-primary' : 'btn-secondary'}`}
          onClick={() => setActiveTab('ledger')}
          style={{ padding: '0.4rem 0.85rem', fontSize: '0.85rem' }}
        >
          📖 Ledger Entries ({ledgerEntries.length})
        </button>
      </div>

      {loading && !summary ? (
        <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
          Loading operational telemetry...
        </div>
      ) : (
        <>
          {/* TAB 1: OVERVIEW METRICS */}
          {activeTab === 'overview' && summary && (
            <div>
              <div className="grid grid-3" style={{ marginBottom: '1.5rem' }}>
                <div
                  style={{
                    background: '#f8fafc',
                    padding: '1.25rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    Active Wallets
                  </div>
                  <div
                    style={{
                      fontSize: '1.75rem',
                      fontWeight: 700,
                      color: 'var(--primary)',
                      marginTop: '0.25rem',
                    }}
                  >
                    {summary.activeWallets ?? 0}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                    }}
                  >
                    Simulated Accounts Live
                  </div>
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    padding: '1.25rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    Total Transacted Volume
                  </div>
                  <div
                    style={{
                      fontSize: '1.75rem',
                      fontWeight: 700,
                      color: '#10b981',
                      marginTop: '0.25rem',
                    }}
                  >
                    $
                    {Number(summary.totalVolume ?? 0).toLocaleString('en-US', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                    }}
                  >
                    Simulated USD equivalent
                  </div>
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    padding: '1.25rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    Open Disputes
                  </div>
                  <div
                    style={{
                      fontSize: '1.75rem',
                      fontWeight: 700,
                      color: openDisputeCount > 0 ? '#f59e0b' : '#10b981',
                      marginTop: '0.25rem',
                    }}
                  >
                    {openDisputeCount}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                    }}
                  >
                    Requires Analyst Review
                  </div>
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    padding: '1.25rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    Pending Transactions
                  </div>
                  <div
                    style={{
                      fontSize: '1.75rem',
                      fontWeight: 700,
                      color: 'var(--text-dark)',
                      marginTop: '0.25rem',
                    }}
                  >
                    {summary.pendingTransactions ?? 0}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                    }}
                  >
                    Settlement Pipeline
                  </div>
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    padding: '1.25rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    Ledger Audit Records
                  </div>
                  <div
                    style={{
                      fontSize: '1.75rem',
                      fontWeight: 700,
                      color: 'var(--text-dark)',
                      marginTop: '0.25rem',
                    }}
                  >
                    {summary.immutableLedgerEntries ?? 0}
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                    }}
                  >
                    Double-entry postings
                  </div>
                </div>

                <div
                  style={{
                    background: '#f8fafc',
                    padding: '1.25rem',
                    borderRadius: '8px',
                    border: '1px solid var(--border)',
                  }}
                >
                  <div
                    style={{
                      fontSize: '0.8rem',
                      color: 'var(--text-muted)',
                      textTransform: 'uppercase',
                      fontWeight: 600,
                    }}
                  >
                    Telemetry Status
                  </div>
                  <div
                    style={{
                      fontSize: '1.25rem',
                      fontWeight: 700,
                      color: '#10b981',
                      marginTop: '0.5rem',
                      display: 'flex',
                      alignItems: 'center',
                      gap: '0.5rem',
                    }}
                  >
                    <span
                      style={{
                        width: 10,
                        height: 10,
                        borderRadius: '50%',
                        background: '#10b981',
                        display: 'inline-block',
                      }}
                    ></span>
                    HEALTHY
                  </div>
                  <div
                    style={{
                      fontSize: '0.75rem',
                      color: 'var(--text-muted)',
                      marginTop: '0.25rem',
                    }}
                  >
                    PostgreSQL & Ledger Synchronized
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: DISPUTES ESCALATIONS */}
          {activeTab === 'disputes' && (
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>
                Customer Dispute Queue
              </h3>
              {disputes.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No customer disputes on record.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Dispute ID</th>
                        <th>Transaction ID</th>
                        <th>Reason</th>
                        <th>Customer Claim</th>
                        <th>Status</th>
                        <th>Created</th>
                        <th>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {disputes.map(d => (
                        <tr key={d.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {d.id.slice(0, 8)}...
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {d.transactionId?.slice(0, 8) ?? '—'}...
                          </td>
                          <td style={{ textTransform: 'capitalize', fontWeight: 500 }}>
                            {d.reason?.replace('_', ' ')}
                          </td>
                          <td
                            style={{
                              maxWidth: '240px',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              fontSize: '0.85rem',
                            }}
                            title={d.details}
                          >
                            {d.details || '—'}
                          </td>
                          <td>
                            <span className={`status-badge status-${d.status}`}>
                              {d.status?.replace('_', ' ')}
                            </span>
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>
                            {new Date(d.createdAt).toLocaleDateString()}
                          </td>
                          <td>
                            <button
                              className="btn btn-secondary"
                              style={{ padding: '0.25rem 0.6rem', fontSize: '0.75rem' }}
                              onClick={() => {
                                setSelectedDispute(d);
                                setResolutionStatus(
                                  d.status === 'pending_review' ? 'under_investigation' : d.status
                                );
                                setResolutionNotes(d.resolutionNotes || '');
                              }}
                            >
                              Adjudicate
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 3: GLOBAL TRANSACTIONS */}
          {activeTab === 'transactions' && (
            <div>
              <h3 style={{ fontSize: '1.1rem', fontWeight: 600, marginBottom: '0.75rem' }}>
                System Transactions
              </h3>
              {transactions.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No transactions recorded.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>ID</th>
                        <th>Wallet ID</th>
                        <th>Type</th>
                        <th>Amount</th>
                        <th>Status</th>
                        <th>Description</th>
                        <th>Timestamp</th>
                      </tr>
                    </thead>
                    <tbody>
                      {transactions.map(t => (
                        <tr key={t.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {t.id.slice(0, 8)}...
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {t.walletId?.slice(0, 8)}...
                          </td>
                          <td style={{ textTransform: 'capitalize', fontWeight: 500 }}>{t.type}</td>
                          <td style={{ fontWeight: 600 }}>
                            {t.currency} {Number(t.amount).toFixed(2)}
                          </td>
                          <td>
                            <span className={`status-badge status-${t.status}`}>{t.status}</span>
                          </td>
                          <td style={{ fontSize: '0.85rem' }}>{t.description || '—'}</td>
                          <td style={{ fontSize: '0.85rem' }}>
                            {new Date(t.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 4: IMMUTABLE LEDGER */}
          {activeTab === 'ledger' && (
            <div>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  marginBottom: '0.75rem',
                }}
              >
                <h3 style={{ fontSize: '1.1rem', fontWeight: 600, margin: 0 }}>
                  Double-Entry Ledger Audit Trail
                </h3>
                <span className="simulated-badge">Immutable Append-Only</span>
              </div>
              {ledgerEntries.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '2rem', color: 'var(--text-muted)' }}>
                  No ledger entries recorded.
                </div>
              ) : (
                <div className="table-responsive">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Entry ID</th>
                        <th>Tx Reference</th>
                        <th>Wallet ID</th>
                        <th>Entry Type</th>
                        <th>Amount</th>
                        <th>Currency</th>
                        <th>Posted At</th>
                      </tr>
                    </thead>
                    <tbody>
                      {ledgerEntries.map(le => (
                        <tr key={le.id}>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {le.id.slice(0, 8)}...
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {le.transactionId
                              ? `${le.transactionId.slice(0, 8)}...`
                              : 'Genesis / System'}
                          </td>
                          <td style={{ fontFamily: 'monospace', fontSize: '0.85rem' }}>
                            {le.walletId.slice(0, 8)}...
                          </td>
                          <td>
                            <span
                              style={{
                                fontWeight: 700,
                                color: le.entryType === 'credit' ? '#10b981' : '#ef4444',
                                textTransform: 'uppercase',
                                fontSize: '0.8rem',
                              }}
                            >
                              {le.entryType}
                            </span>
                          </td>
                          <td style={{ fontWeight: 600 }}>
                            {le.entryType === 'credit' ? '+' : '-'}
                            {Number(le.amount).toFixed(2)}
                          </td>
                          <td>{le.currency}</td>
                          <td style={{ fontSize: '0.85rem' }}>
                            {new Date(le.createdAt).toLocaleString()}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </>
      )}

      {/* DISPUTE RESOLUTION MODAL */}
      {selectedDispute && (
        <div className="modal-backdrop">
          <div className="modal-dialog">
            <h3
              style={{
                fontSize: '1.25rem',
                fontWeight: 700,
                marginTop: 0,
                marginBottom: '0.75rem',
              }}
            >
              Adjudicate Customer Dispute
            </h3>
            <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: '1rem' }}>
              Review customer claim evidence, determine validity, and transition compliance state.
            </p>

            <div
              style={{
                background: '#f8fafc',
                padding: '1rem',
                borderRadius: '6px',
                marginBottom: '1rem',
                fontSize: '0.85rem',
              }}
            >
              <div>
                <strong>Dispute ID:</strong> {selectedDispute.id}
              </div>
              <div>
                <strong>Transaction ID:</strong> {selectedDispute.transactionId}
              </div>
              <div>
                <strong>Reason:</strong> {selectedDispute.reason?.replace('_', ' ')}
              </div>
              <div>
                <strong>Customer Claim:</strong> {selectedDispute.details || 'None'}
              </div>
              <div>
                <strong>Current Status:</strong>{' '}
                <span className={`status-badge status-${selectedDispute.status}`}>
                  {selectedDispute.status}
                </span>
              </div>
            </div>

            <form onSubmit={handleResolveSubmit}>
              <div className="form-group">
                <label className="form-label" htmlFor="resolutionStatus">
                  Action Decision *
                </label>
                <select
                  id="resolutionStatus"
                  className="form-control"
                  value={resolutionStatus}
                  onChange={e => setResolutionStatus(e.target.value as DisputeStatus)}
                >
                  <option value="under_investigation">
                    Under Investigation (Awaiting Further Evidence)
                  </option>
                  <option value="resolved">
                    Resolved (In Favor of Customer - Provisional Credit)
                  </option>
                  <option value="rejected">Rejected (Claim Denied / No Irregularity Found)</option>
                </select>
              </div>

              <div className="form-group">
                <label className="form-label" htmlFor="resolutionNotes">
                  Compliance Investigation Notes *
                </label>
                <textarea
                  id="resolutionNotes"
                  className="form-control"
                  rows={3}
                  placeholder="Record findings, merchant correspondence, or regulatory reasoning..."
                  value={resolutionNotes}
                  onChange={e => setResolutionNotes(e.target.value)}
                  required
                />
              </div>

              <div
                style={{
                  display: 'flex',
                  justifyContent: 'flex-end',
                  gap: '0.75rem',
                  marginTop: '1.5rem',
                }}
              >
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={() => setSelectedDispute(null)}
                  disabled={resolving}
                >
                  Cancel
                </button>
                <button type="submit" className="btn btn-primary" disabled={resolving}>
                  {resolving ? 'Saving...' : 'Commit Decision'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
