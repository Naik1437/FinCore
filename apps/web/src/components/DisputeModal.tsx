import React, { useState } from 'react';
import { api } from '../services/api';
import type { Dispute, Transaction } from '../types';

interface DisputeModalProps {
  transaction: Transaction | null;
  onClose: () => void;
  onDisputeCreated: (dispute: Dispute) => void;
}

export const DisputeModal: React.FC<DisputeModalProps> = ({
  transaction,
  onClose,
  onDisputeCreated,
}) => {
  const [reason, setReason] = useState<string>('Unrecognized merchant charge');
  const [details, setDetails] = useState<string>('');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  if (!transaction) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!details.trim() || details.trim().length < 5) {
      setError('Please provide at least 5 characters explaining your dispute');
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const dispute = await api.createDispute({
        transactionId: transaction.id,
        reason,
        details: details.trim(),
      });
      onDisputeCreated(dispute);
      onClose();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit dispute');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="dispute-modal-title"
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
          <div>
            <h3 id="dispute-modal-title" style={{ fontSize: '1.25rem', fontWeight: 700 }}>
              ⚖️ Raise Transaction Dispute
            </h3>
            <p style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
              Submit an investigation request to our operations analyst team.
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            style={{ fontSize: '1.5rem', lineHeight: '1', color: 'var(--gray-400)' }}
            aria-label="Close modal"
          >
            &times;
          </button>
        </div>

        {error && (
          <div
            style={{
              backgroundColor: 'var(--danger-light)',
              color: 'var(--danger)',
              padding: '0.75rem',
              borderRadius: 'var(--radius-md)',
              marginBottom: '1rem',
              border: '1px solid #fecaca',
              fontSize: '0.8125rem',
            }}
          >
            ⚠️ {error}
          </div>
        )}

        {/* Transaction Summary Card */}
        <div
          style={{
            backgroundColor: 'var(--gray-50)',
            padding: '0.875rem 1rem',
            borderRadius: 'var(--radius-md)',
            border: '1px solid var(--gray-200)',
            marginBottom: '1.25rem',
            fontSize: '0.8125rem',
            lineHeight: '1.8',
          }}
        >
          <div>
            <strong>Transaction ID:</strong> <code>{transaction.id}</code>
          </div>
          <div>
            <strong>Amount:</strong> {transaction.currency} {transaction.amount.toFixed(2)}
          </div>
          <div>
            <strong>Description:</strong> {transaction.description || 'Simulated charge'}
          </div>
          <div>
            <strong>Date:</strong> {new Date(transaction.createdAt).toLocaleDateString()}
          </div>
        </div>

        <form onSubmit={handleSubmit} noValidate>
          <div style={{ marginBottom: '1rem' }}>
            <label htmlFor="dispute-reason">Dispute Reason</label>
            <select id="dispute-reason" value={reason} onChange={e => setReason(e.target.value)}>
              <option value="Unrecognized merchant charge">Unrecognized merchant charge</option>
              <option value="Duplicate transaction">Duplicate transaction</option>
              <option value="Incorrect charge amount">Incorrect charge amount</option>
              <option value="Goods or service not received">Goods or service not received</option>
              <option value="Unauthorized transfer">Unauthorized transfer</option>
              <option value="Other billing issue">Other billing issue</option>
            </select>
          </div>

          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="dispute-details">
              Explanation & Evidence <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <textarea
              id="dispute-details"
              rows={4}
              placeholder="Provide a detailed explanation of why this transaction is disputed..."
              value={details}
              onChange={e => setDetails(e.target.value)}
            />
          </div>

          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
            <button type="button" className="btn-secondary" onClick={onClose} disabled={loading}>
              Cancel
            </button>
            <button type="submit" className="btn-primary" disabled={loading}>
              {loading ? 'Submitting...' : 'Submit Dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
