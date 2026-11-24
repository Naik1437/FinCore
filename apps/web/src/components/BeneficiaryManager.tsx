import React, { useState } from 'react';
import { api } from '../services/api';
import type { Beneficiary, CreateBeneficiaryPayload } from '../types';

interface BeneficiaryManagerProps {
  beneficiaries: Beneficiary[];
  onBeneficiariesChange: () => void;
  onSelectForTransfer?: (beneficiary: Beneficiary) => void;
}

export const BeneficiaryManager: React.FC<BeneficiaryManagerProps> = ({
  beneficiaries,
  onBeneficiariesChange,
  onSelectForTransfer,
}) => {
  const [showModal, setShowModal] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [formData, setFormData] = useState<CreateBeneficiaryPayload>({
    name: '',
    accountNumber: '',
    routingNumber: '',
    bankName: '',
    currency: 'USD',
  });

  const [formErrors, setFormErrors] = useState<Record<string, string>>({});

  const validate = (): boolean => {
    const errors: Record<string, string> = {};
    if (!formData.name.trim() || formData.name.trim().length < 2) {
      errors.name = 'Full name must be at least 2 characters';
    }
    if (!formData.bankName.trim()) {
      errors.bankName = 'Bank name is required';
    }
    if (!formData.accountNumber.trim() || formData.accountNumber.trim().length < 4) {
      errors.accountNumber = 'Account/IBAN must be at least 4 characters';
    }
    setFormErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;

    setLoading(true);
    setError(null);
    try {
      await api.createBeneficiary(formData);
      setSuccess(`Beneficiary "${formData.name}" added successfully.`);
      setShowModal(false);
      setFormData({
        name: '',
        accountNumber: '',
        routingNumber: '',
        bankName: '',
        currency: 'USD',
      });
      onBeneficiariesChange();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to add beneficiary');
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to remove ${name} from your beneficiaries?`)) {
      return;
    }

    try {
      await api.deleteBeneficiary(id);
      setSuccess(`Beneficiary ${name} removed.`);
      onBeneficiariesChange();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to delete beneficiary');
    }
  };

  return (
    <section aria-labelledby="beneficiaries-title" style={{ marginTop: '1.5rem' }}>
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
            id="beneficiaries-title"
            style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gray-900)' }}
          >
            Saved Beneficiaries
          </h2>
          <p style={{ fontSize: '0.875rem', color: 'var(--gray-500)' }}>
            Manage approved transfer recipients and simulated external routing profiles.
          </p>
        </div>
        <button
          type="button"
          className="btn-primary"
          onClick={() => {
            setError(null);
            setShowModal(true);
          }}
        >
          ➕ Add Beneficiary
        </button>
      </div>

      {success && (
        <div
          style={{
            backgroundColor: 'var(--success-light)',
            color: 'var(--success)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1rem',
            border: '1px solid #a7f3d0',
          }}
        >
          ✓ {success}
        </div>
      )}

      {error && (
        <div
          style={{
            backgroundColor: 'var(--danger-light)',
            color: 'var(--danger)',
            padding: '0.75rem 1rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1rem',
            border: '1px solid #fecaca',
          }}
        >
          ⚠️ {error}
        </div>
      )}

      {/* Beneficiary List */}
      {beneficiaries.length === 0 ? (
        <div
          className="card"
          style={{ textAlign: 'center', padding: '3rem 1rem', color: 'var(--gray-500)' }}
        >
          <div style={{ fontSize: '2.5rem', marginBottom: '0.5rem' }}>👥</div>
          <h3 style={{ fontSize: '1.125rem', fontWeight: 600, color: 'var(--gray-800)' }}>
            No beneficiaries added yet
          </h3>
          <p style={{ fontSize: '0.875rem', maxWidth: '400px', margin: '0.5rem auto 1.5rem' }}>
            Add your first beneficiary to enable instant, validated transfers across simulated
            banking routes.
          </p>
          <button type="button" className="btn-primary" onClick={() => setShowModal(true)}>
            Add Beneficiary Now
          </button>
        </div>
      ) : (
        <div className="grid-cols-auto">
          {beneficiaries.map(ben => (
            <div
              key={ben.id}
              className="card"
              style={{ display: 'flex', flexDirection: 'column', justifyContent: 'space-between' }}
            >
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'flex-start',
                    marginBottom: '0.5rem',
                  }}
                >
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 600, color: 'var(--gray-900)' }}>
                    {ben.name}
                  </h3>
                  <span className="status-badge status-active">{ben.currency}</span>
                </div>
                <div style={{ fontSize: '0.8125rem', color: 'var(--gray-600)', lineHeight: '1.6' }}>
                  <div>
                    🏛️ <strong>Bank:</strong> {ben.bankName}
                  </div>
                  <div>
                    💳 <strong>Account:</strong> <code>{ben.accountNumber}</code>
                  </div>
                  {ben.routingNumber && (
                    <div>
                      🧭 <strong>Routing/BIC:</strong> <code>{ben.routingNumber}</code>
                    </div>
                  )}
                </div>
              </div>

              <div
                style={{
                  display: 'flex',
                  gap: '0.5rem',
                  marginTop: '1.25rem',
                  paddingTop: '0.75rem',
                  borderTop: '1px solid var(--gray-100)',
                }}
              >
                {onSelectForTransfer && (
                  <button
                    type="button"
                    className="btn-primary btn-sm"
                    onClick={() => onSelectForTransfer(ben)}
                    style={{ flex: 1 }}
                  >
                    Send to Recipient
                  </button>
                )}
                <button
                  type="button"
                  className="btn-danger btn-sm"
                  onClick={() => handleDelete(ben.id, ben.name)}
                  aria-label={`Remove beneficiary ${ben.name}`}
                >
                  Remove
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Add Beneficiary Modal */}
      {showModal && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="modal-add-beneficiary"
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
              <h3 id="modal-add-beneficiary" style={{ fontSize: '1.25rem', fontWeight: 700 }}>
                Add New Beneficiary
              </h3>
              <button
                type="button"
                onClick={() => setShowModal(false)}
                style={{ fontSize: '1.5rem', lineHeight: '1', color: 'var(--gray-400)' }}
                aria-label="Close modal"
              >
                &times;
              </button>
            </div>

            <form onSubmit={handleSubmit} noValidate>
              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="ben-name">
                  Beneficiary Name <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  id="ben-name"
                  type="text"
                  placeholder="e.g. Acme Corp or Jane Doe"
                  value={formData.name}
                  onChange={e => setFormData({ ...formData, name: e.target.value })}
                  aria-invalid={!!formErrors.name}
                  aria-describedby={formErrors.name ? 'ben-name-err' : undefined}
                />
                {formErrors.name && (
                  <p
                    id="ben-name-err"
                    style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.25rem' }}
                  >
                    {formErrors.name}
                  </p>
                )}
              </div>

              <div style={{ marginBottom: '1rem' }}>
                <label htmlFor="ben-bank">
                  Bank / Institution Name <span style={{ color: 'var(--danger)' }}>*</span>
                </label>
                <input
                  id="ben-bank"
                  type="text"
                  placeholder="e.g. JPMorgan Chase (Simulated)"
                  value={formData.bankName}
                  onChange={e => setFormData({ ...formData, bankName: e.target.value })}
                  aria-invalid={!!formErrors.bankName}
                  aria-describedby={formErrors.bankName ? 'ben-bank-err' : undefined}
                />
                {formErrors.bankName && (
                  <p
                    id="ben-bank-err"
                    style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.25rem' }}
                  >
                    {formErrors.bankName}
                  </p>
                )}
              </div>

              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr',
                  gap: '0.75rem',
                  marginBottom: '1rem',
                }}
              >
                <div>
                  <label htmlFor="ben-account">
                    Account / IBAN <span style={{ color: 'var(--danger)' }}>*</span>
                  </label>
                  <input
                    id="ben-account"
                    type="text"
                    placeholder="e.g. ACC-19283746"
                    value={formData.accountNumber}
                    onChange={e => setFormData({ ...formData, accountNumber: e.target.value })}
                    aria-invalid={!!formErrors.accountNumber}
                    aria-describedby={formErrors.accountNumber ? 'ben-account-err' : undefined}
                  />
                  {formErrors.accountNumber && (
                    <p
                      id="ben-account-err"
                      style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.25rem' }}
                    >
                      {formErrors.accountNumber}
                    </p>
                  )}
                </div>

                <div>
                  <label htmlFor="ben-currency">Currency</label>
                  <select
                    id="ben-currency"
                    value={formData.currency}
                    onChange={e => setFormData({ ...formData, currency: e.target.value })}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                  </select>
                </div>
              </div>

              <div style={{ marginBottom: '1.5rem' }}>
                <label htmlFor="ben-routing">
                  Routing Number / BIC{' '}
                  <span style={{ color: 'var(--gray-400)', fontWeight: 400 }}>(Optional)</span>
                </label>
                <input
                  id="ben-routing"
                  type="text"
                  placeholder="e.g. ROUT-02100002"
                  value={formData.routingNumber || ''}
                  onChange={e => setFormData({ ...formData, routingNumber: e.target.value })}
                />
              </div>

              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '0.75rem' }}>
                <button
                  type="button"
                  className="btn-secondary"
                  onClick={() => setShowModal(false)}
                  disabled={loading}
                >
                  Cancel
                </button>
                <button type="submit" className="btn-primary" disabled={loading}>
                  {loading ? 'Adding...' : 'Save Beneficiary'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </section>
  );
};
