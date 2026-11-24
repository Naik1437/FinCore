import React, { useState } from 'react';
import type { Transaction, TransactionStatus, TransactionType } from '../types';

interface TransactionListProps {
  transactions: Transaction[];
  onDisputeClick: (transaction: Transaction) => void;
  loading?: boolean;
}

export const TransactionList: React.FC<TransactionListProps> = ({
  transactions,
  onDisputeClick,
  loading = false,
}) => {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedTxn, setSelectedTxn] = useState<Transaction | null>(null);

  const filtered = transactions.filter(txn => {
    if (statusFilter !== 'all' && txn.status !== statusFilter) return false;
    if (typeFilter !== 'all' && txn.type !== typeFilter) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const descMatch = (txn.description || '').toLowerCase().includes(q);
      const idMatch = txn.id.toLowerCase().includes(q);
      if (!descMatch && !idMatch) return false;
    }
    return true;
  });

  const getStatusBadgeClass = (status: TransactionStatus): string => {
    switch (status) {
      case 'completed':
        return 'status-completed';
      case 'pending':
      case 'processing':
        return 'status-pending';
      case 'failed':
        return 'status-failed';
      case 'cancelled':
        return 'status-cancelled';
      default:
        return 'status-cancelled';
    }
  };

  const getTypeIcon = (type: TransactionType): string => {
    switch (type) {
      case 'deposit':
        return '📥 Deposit';
      case 'withdrawal':
        return '📤 Withdrawal';
      case 'transfer':
        return '💸 Transfer';
      case 'payment':
        return '💳 Payment';
      default:
        return type;
    }
  };

  return (
    <section aria-labelledby="txns-title" style={{ marginTop: '1.5rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          flexWrap: 'wrap',
          gap: '0.75rem',
        }}
      >
        <div>
          <h2
            id="txns-title"
            style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gray-900)' }}
          >
            Transaction History & States
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
            Track simulated ledger entries, inspect lifecycle states, and raise disputes if needed.
          </p>
        </div>
      </div>

      {/* Filter Bar */}
      <div
        className="card"
        style={{
          padding: '1rem',
          marginBottom: '1rem',
          display: 'flex',
          flexWrap: 'wrap',
          gap: '0.75rem',
          alignItems: 'center',
        }}
      >
        <div style={{ flex: '2', minWidth: '200px' }}>
          <label
            htmlFor="search-txns"
            style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--gray-500)' }}
          >
            Search description or ID
          </label>
          <input
            id="search-txns"
            type="search"
            placeholder="Search transactions..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
        </div>

        <div style={{ flex: '1', minWidth: '140px' }}>
          <label
            htmlFor="filter-status"
            style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--gray-500)' }}
          >
            Status
          </label>
          <select
            id="filter-status"
            value={statusFilter}
            onChange={e => setStatusFilter(e.target.value)}
          >
            <option value="all">All States</option>
            <option value="completed">Completed</option>
            <option value="pending">Pending</option>
            <option value="processing">Processing</option>
            <option value="failed">Failed</option>
            <option value="cancelled">Cancelled</option>
          </select>
        </div>

        <div style={{ flex: '1', minWidth: '140px' }}>
          <label
            htmlFor="filter-type"
            style={{ fontSize: '0.75rem', textTransform: 'uppercase', color: 'var(--gray-500)' }}
          >
            Type
          </label>
          <select id="filter-type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}>
            <option value="all">All Types</option>
            <option value="transfer">Transfer</option>
            <option value="deposit">Deposit</option>
            <option value="withdrawal">Withdrawal</option>
            <option value="payment">Payment</option>
          </select>
        </div>

        {(statusFilter !== 'all' || typeFilter !== 'all' || searchQuery) && (
          <button
            type="button"
            className="btn-secondary btn-sm"
            onClick={() => {
              setStatusFilter('all');
              setTypeFilter('all');
              setSearchQuery('');
            }}
            style={{ alignSelf: 'flex-end', height: '38px' }}
          >
            Reset Filters
          </button>
        )}
      </div>

      {/* Transactions Table */}
      {loading ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}
        >
          Loading transactions from database...
        </div>
      ) : filtered.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--gray-500)' }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>📜</div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--gray-800)' }}>
            No matching transactions found
          </h3>
          <p style={{ fontSize: '0.875rem', margin: '0.5rem 0' }}>
            Try adjusting your search query or status filter to see other synthetic transaction
            records.
          </p>
        </div>
      ) : (
        <div className="table-container">
          <table aria-label="Transactions Table">
            <thead>
              <tr>
                <th scope="col">Date & Time</th>
                <th scope="col">Type</th>
                <th scope="col">Description</th>
                <th scope="col">Amount</th>
                <th scope="col">State</th>
                <th scope="col" style={{ textAlign: 'right' }}>
                  Actions
                </th>
              </tr>
            </thead>
            <tbody>
              {filtered.map(txn => {
                const isDebit = txn.type !== 'deposit';
                return (
                  <tr key={txn.id}>
                    <td
                      style={{
                        whiteSpace: 'nowrap',
                        fontSize: '0.8125rem',
                        color: 'var(--gray-600)',
                      }}
                    >
                      {new Date(txn.createdAt).toLocaleDateString()}{' '}
                      {new Date(txn.createdAt).toLocaleTimeString([], {
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </td>
                    <td style={{ whiteSpace: 'nowrap', fontWeight: 500 }}>
                      {getTypeIcon(txn.type)}
                    </td>
                    <td>
                      <div style={{ fontWeight: 500, color: 'var(--gray-900)' }}>
                        {txn.description || 'Simulated transaction'}
                      </div>
                      <div style={{ fontSize: '0.75rem', color: 'var(--gray-400)' }}>
                        ID: <code>{txn.id.slice(0, 8)}...</code>
                      </div>
                    </td>
                    <td
                      style={{
                        whiteSpace: 'nowrap',
                        fontWeight: 600,
                        color: isDebit ? 'var(--gray-900)' : 'var(--success)',
                      }}
                    >
                      {isDebit ? '-' : '+'}
                      {txn.currency}{' '}
                      {txn.amount.toLocaleString('en-US', { minimumFractionDigits: 2 })}
                    </td>
                    <td>
                      <span className={`status-badge ${getStatusBadgeClass(txn.status)}`}>
                        ● {txn.status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      <button
                        type="button"
                        className="btn-secondary btn-sm"
                        onClick={() => setSelectedTxn(txn)}
                        style={{ marginRight: '0.5rem' }}
                      >
                        Inspect
                      </button>
                      <button
                        type="button"
                        className="btn-danger btn-sm"
                        onClick={() => onDisputeClick(txn)}
                        title="Raise dispute on this transaction"
                      >
                        Dispute
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Inspect Modal */}
      {selectedTxn && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="inspect-txn-title"
        >
          <div className="modal-content">
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '1.25rem',
              }}
            >
              <h3 id="inspect-txn-title" style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                Transaction Details
              </h3>
              <button
                type="button"
                onClick={() => setSelectedTxn(null)}
                style={{ fontSize: '1.5rem', lineHeight: '1', color: 'var(--gray-400)' }}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <div
              style={{
                backgroundColor: 'var(--gray-50)',
                padding: '1.25rem',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--gray-200)',
                lineHeight: '2',
                fontSize: '0.875rem',
              }}
            >
              <div>
                <strong>Transaction UUID:</strong> <code>{selectedTxn.id}</code>
              </div>
              <div>
                <strong>Wallet UUID:</strong> <code>{selectedTxn.walletId}</code>
              </div>
              <div>
                <strong>Type:</strong> {getTypeIcon(selectedTxn.type)}
              </div>
              <div>
                <strong>Amount:</strong> {selectedTxn.currency} {selectedTxn.amount.toFixed(2)}
              </div>
              <div>
                <strong>State:</strong>{' '}
                <span className={`status-badge ${getStatusBadgeClass(selectedTxn.status)}`}>
                  ● {selectedTxn.status}
                </span>
              </div>
              <div>
                <strong>Description:</strong> {selectedTxn.description}
              </div>
              <div>
                <strong>Timestamp:</strong> {new Date(selectedTxn.createdAt).toISOString()}
              </div>
              <div>
                <strong>Simulated:</strong>{' '}
                <span className="simulated-badge" style={{ fontSize: '0.65rem' }}>
                  Yes
                </span>
              </div>
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
                className="btn-danger"
                onClick={() => {
                  const t = selectedTxn;
                  setSelectedTxn(null);
                  onDisputeClick(t);
                }}
              >
                ⚖️ Raise Dispute
              </button>
              <button type="button" className="btn-secondary" onClick={() => setSelectedTxn(null)}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
};
