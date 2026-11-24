import React from 'react';
import type { Dispute, DisputeStatus } from '../types';

interface DisputeManagerProps {
  disputes: Dispute[];
  loading?: boolean;
}

export const DisputeManager: React.FC<DisputeManagerProps> = ({ disputes, loading = false }) => {
  const getDisputeBadge = (status: DisputeStatus) => {
    switch (status) {
      case 'pending_review':
        return <span className="status-badge status-pending_review">● Pending Review</span>;
      case 'under_investigation':
        return (
          <span className="status-badge status-under_investigation">● Under Investigation</span>
        );
      case 'resolved':
        return <span className="status-badge status-resolved">✓ Resolved</span>;
      case 'rejected':
        return <span className="status-badge status-rejected">✕ Rejected</span>;
      default:
        return <span className="status-badge status-cancelled">● {status}</span>;
    }
  };

  return (
    <section aria-labelledby="disputes-title" style={{ marginTop: '1.5rem' }}>
      <div style={{ marginBottom: '1.25rem' }}>
        <h2
          id="disputes-title"
          style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gray-900)' }}
        >
          Dispute Management & Case Tracking
        </h2>
        <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
          Review the status of claims raised against simulated charges. Handled by the operations
          analyst team.
        </p>
      </div>

      {loading ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '3rem', color: 'var(--gray-500)' }}
        >
          Loading dispute cases...
        </div>
      ) : disputes.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--gray-500)' }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>⚖️</div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--gray-800)' }}>
            No disputes filed
          </h3>
          <p style={{ fontSize: '0.875rem', maxWidth: '420px', margin: '0.5rem auto' }}>
            All your transactions are in good standing. You can raise a dispute directly from any
            transaction in the History tab.
          </p>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem' }}>
          {disputes.map(disp => (
            <div key={disp.id} className="card" style={{ borderLeft: '4px solid var(--warning)' }}>
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'flex-start',
                  flexWrap: 'wrap',
                  gap: '0.5rem',
                  marginBottom: '0.75rem',
                }}
              >
                <div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--gray-900)' }}>
                      {disp.reason}
                    </h3>
                    {getDisputeBadge(disp.status)}
                  </div>
                  <div
                    style={{ fontSize: '0.75rem', color: 'var(--gray-500)', marginTop: '0.25rem' }}
                  >
                    Case ID: <code>{disp.id}</code> • Opened on{' '}
                    {new Date(disp.createdAt).toLocaleDateString()}
                  </div>
                </div>

                {disp.transaction && (
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontWeight: 700, fontSize: '1rem', color: 'var(--gray-900)' }}>
                      {disp.transaction.currency} {disp.transaction.amount.toFixed(2)}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--gray-500)' }}>
                      {disp.transaction.description}
                    </div>
                  </div>
                )}
              </div>

              <div
                style={{
                  backgroundColor: 'var(--gray-50)',
                  padding: '0.75rem 1rem',
                  borderRadius: 'var(--radius-md)',
                  fontSize: '0.8125rem',
                  color: 'var(--gray-700)',
                  marginBottom: '0.5rem',
                }}
              >
                <strong>Customer Claim:</strong> {disp.details}
              </div>

              {disp.resolutionNotes && (
                <div
                  style={{
                    backgroundColor: '#f0fdf4',
                    border: '1px solid #bbf7d0',
                    padding: '0.75rem 1rem',
                    borderRadius: 'var(--radius-md)',
                    fontSize: '0.8125rem',
                    color: '#166534',
                  }}
                >
                  <strong>Operations Resolution:</strong> {disp.resolutionNotes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
};
