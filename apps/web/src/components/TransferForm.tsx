import React, { useEffect, useState } from 'react';
import { api } from '../services/api';
import type { Beneficiary, Transaction, Wallet } from '../types';

interface TransferFormProps {
  wallets: Wallet[];
  beneficiaries: Beneficiary[];
  selectedWalletId?: string;
  onTransferSuccess: (txn: Transaction, newBalance: number) => void;
  onNavigateToBeneficiaries: () => void;
  onCloseReceipt?: () => void;
}

export const TransferForm: React.FC<TransferFormProps> = ({
  wallets,
  beneficiaries,
  selectedWalletId,
  onTransferSuccess,
  onNavigateToBeneficiaries,
  onCloseReceipt,
}) => {
  const [sourceWalletId, setSourceWalletId] = useState<string>(
    selectedWalletId || (wallets.length > 0 ? wallets[0].id : '')
  );
  const [beneficiaryId, setBeneficiaryId] = useState<string>(
    beneficiaries.length > 0 ? beneficiaries[0].id : ''
  );

  useEffect(() => {
    if (selectedWalletId && wallets.some(w => w.id === selectedWalletId)) {
      setSourceWalletId(selectedWalletId);
    } else if (
      wallets.length > 0 &&
      (!sourceWalletId || !wallets.some(w => w.id === sourceWalletId))
    ) {
      setSourceWalletId(wallets[0].id);
    }
  }, [wallets, selectedWalletId]);

  useEffect(() => {
    if (
      beneficiaries.length > 0 &&
      (!beneficiaryId || !beneficiaries.some(b => b.id === beneficiaryId))
    ) {
      setBeneficiaryId(beneficiaries[0].id);
    }
  }, [beneficiaries]);
  const [amountStr, setAmountStr] = useState<string>('');
  const [description, setDescription] = useState<string>('');
  const [step, setStep] = useState<'edit' | 'confirm'>('edit');
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [completedTxn, setCompletedTxn] = useState<Transaction | null>(null);
  const [idempotencyKey, setIdempotencyKey] = useState<string>('');

  const currentWallet = wallets.find(w => w.id === sourceWalletId);
  const currentBeneficiary = beneficiaries.find(b => b.id === beneficiaryId);
  const amount = parseFloat(amountStr) || 0;

  const validate = (): boolean => {
    const errors: Record<string, string> = {};

    if (!sourceWalletId) {
      errors.sourceWalletId = 'Please select a source wallet';
    }

    if (!beneficiaryId) {
      errors.beneficiaryId = 'Please select a beneficiary';
    }

    if (!amountStr || isNaN(amount) || amount <= 0) {
      errors.amount = 'Transfer amount must be strictly greater than 0';
    } else if (currentWallet && amount > currentWallet.balance) {
      errors.amount = `Insufficient simulated funds. Available balance: $${currentWallet.balance.toFixed(2)} ${currentWallet.currency}`;
    }

    if (
      currentWallet &&
      currentBeneficiary &&
      currentWallet.currency !== currentBeneficiary.currency
    ) {
      errors.currency = `Currency mismatch: source wallet is ${currentWallet.currency} but beneficiary is ${currentBeneficiary.currency}`;
    }

    if (!description.trim()) {
      errors.description = 'Please enter a transfer note/reason';
    }

    setFieldErrors(errors);
    return Object.keys(errors).length === 0;
  };

  const handleProceedToReview = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (validate()) {
      setIdempotencyKey(`transfer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`);
      setStep('confirm');
    }
  };

  const handleAuthorizeTransfer = async () => {
    if (loading) return;
    setLoading(true);
    setError(null);
    try {
      const activeKey =
        idempotencyKey || `transfer-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
      const result = await api.createTransfer({
        sourceWalletId,
        beneficiaryId,
        amount,
        description: description.trim(),
        idempotencyKey: activeKey,
      });

      setCompletedTxn(result.transaction);
      onTransferSuccess(result.transaction, result.newBalance);
      setStep('edit');
      setAmountStr('');
      setDescription('');
      setIdempotencyKey('');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Transfer execution failed');
      setStep('edit');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="card" style={{ maxWidth: '680px', margin: '1.5rem auto' }}>
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          marginBottom: '1.25rem',
          borderBottom: '1px solid var(--gray-200)',
          paddingBottom: '0.75rem',
        }}
      >
        <div>
          <h2 style={{ fontSize: '1.25rem', fontWeight: 700, color: 'var(--gray-900)' }}>
            💸 Simulated Fund Transfer
          </h2>
          <p style={{ fontSize: '0.8125rem', color: 'var(--gray-500)' }}>
            Execute simulated transfers backed by PostgreSQL double-entry ledger debit logic.
          </p>
        </div>
        <span className="simulated-badge">Testnet</span>
      </div>

      {error && (
        <div
          role="alert"
          style={{
            backgroundColor: 'var(--danger-light)',
            color: 'var(--danger)',
            padding: '0.875rem 1rem',
            borderRadius: 'var(--radius-md)',
            marginBottom: '1.25rem',
            border: '1px solid #fecaca',
            fontSize: '0.875rem',
          }}
        >
          <strong>Transfer Rejected:</strong> {error}
        </div>
      )}

      {/* Success Receipt Modal */}
      {completedTxn && (
        <div
          className="modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="receipt-title"
        >
          <div className="modal-content" style={{ textAlign: 'center' }}>
            <div
              style={{
                width: '56px',
                height: '56px',
                borderRadius: '50%',
                backgroundColor: 'var(--success-light)',
                color: 'var(--success)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                fontSize: '1.75rem',
                margin: '0 auto 1rem',
              }}
            >
              ✓
            </div>
            <h3
              id="receipt-title"
              style={{ fontSize: '1.25rem', fontWeight: 700, marginBottom: '0.5rem' }}
            >
              Transfer Completed Successfully
            </h3>
            <p style={{ fontSize: '0.875rem', color: 'var(--gray-600)', marginBottom: '1.25rem' }}>
              Your simulated transfer has been debited and logged into the immutable ledger.
            </p>

            <div
              style={{
                backgroundColor: 'var(--gray-50)',
                borderRadius: 'var(--radius-md)',
                padding: '1rem',
                textAlign: 'left',
                fontSize: '0.8125rem',
                lineHeight: '1.8',
                marginBottom: '1.5rem',
                border: '1px solid var(--gray-200)',
              }}
            >
              <div>
                <strong>Transaction ID:</strong> <code>{completedTxn.id}</code>
              </div>
              <div>
                <strong>Status:</strong>{' '}
                <span className="status-badge status-completed">Completed</span>
              </div>
              <div>
                <strong>Amount Debited:</strong> {completedTxn.currency}{' '}
                {completedTxn.amount.toFixed(2)}
              </div>
              <div>
                <strong>Description:</strong> {completedTxn.description}
              </div>
              <div>
                <strong>Timestamp:</strong> {new Date(completedTxn.createdAt).toLocaleString()}
              </div>
            </div>

            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%' }}
              onClick={() => {
                setCompletedTxn(null);
                onCloseReceipt?.();
              }}
            >
              Close Receipt
            </button>
          </div>
        </div>
      )}

      {step === 'edit' ? (
        <form onSubmit={handleProceedToReview} noValidate>
          {/* Source Wallet */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="source-wallet">Source Wallet (Simulated Funds)</label>
            <select
              id="source-wallet"
              value={sourceWalletId}
              onChange={e => setSourceWalletId(e.target.value)}
              aria-invalid={!!fieldErrors.sourceWalletId}
            >
              {wallets.map(w => (
                <option key={w.id} value={w.id}>
                  {w.currency} Wallet — Available: {w.currency} {w.balance.toFixed(2)} ({w.status})
                </option>
              ))}
            </select>
            {fieldErrors.sourceWalletId && (
              <p style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {fieldErrors.sourceWalletId}
              </p>
            )}
          </div>

          {/* Beneficiary */}
          <div style={{ marginBottom: '1.25rem' }}>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.375rem',
              }}
            >
              <label htmlFor="beneficiary-select" style={{ marginBottom: 0 }}>
                Select Approved Beneficiary
              </label>
              <button
                type="button"
                onClick={onNavigateToBeneficiaries}
                style={{ fontSize: '0.75rem', color: 'var(--primary)', fontWeight: 600 }}
              >
                + Manage Beneficiaries
              </button>
            </div>
            {beneficiaries.length === 0 ? (
              <div
                style={{
                  padding: '0.75rem',
                  backgroundColor: 'var(--gray-50)',
                  borderRadius: 'var(--radius-md)',
                  border: '1px solid var(--gray-300)',
                  fontSize: '0.875rem',
                }}
              >
                No beneficiaries saved.{' '}
                <button
                  type="button"
                  onClick={onNavigateToBeneficiaries}
                  style={{ color: 'var(--primary)', textDecoration: 'underline' }}
                >
                  Add a beneficiary first
                </button>{' '}
                to proceed.
              </div>
            ) : (
              <select
                id="beneficiary-select"
                value={beneficiaryId}
                onChange={e => setBeneficiaryId(e.target.value)}
                aria-invalid={!!fieldErrors.beneficiaryId}
              >
                {beneficiaries.map(b => (
                  <option key={b.id} value={b.id}>
                    {b.name} — {b.bankName} ({b.accountNumber}) [{b.currency}]
                  </option>
                ))}
              </select>
            )}
            {fieldErrors.beneficiaryId && (
              <p style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {fieldErrors.beneficiaryId}
              </p>
            )}
            {fieldErrors.currency && (
              <p style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                ⚠️ {fieldErrors.currency}
              </p>
            )}
          </div>

          {/* Amount */}
          <div style={{ marginBottom: '1.25rem' }}>
            <label htmlFor="transfer-amount">
              Transfer Amount ({currentWallet ? currentWallet.currency : 'USD'})
            </label>
            <div style={{ position: 'relative' }}>
              <input
                id="transfer-amount"
                type="number"
                step="0.01"
                min="0.01"
                placeholder="0.00"
                value={amountStr}
                onChange={e => setAmountStr(e.target.value)}
                aria-invalid={!!fieldErrors.amount}
                aria-describedby={fieldErrors.amount ? 'amount-err' : 'amount-balance-info'}
              />
            </div>
            {fieldErrors.amount && (
              <p
                id="amount-err"
                style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.25rem' }}
              >
                {fieldErrors.amount}
              </p>
            )}
            {currentWallet && !fieldErrors.amount && amount > 0 && (
              <p
                id="amount-balance-info"
                style={{ color: 'var(--gray-600)', fontSize: '0.75rem', marginTop: '0.25rem' }}
              >
                Remaining simulated balance after transfer:{' '}
                <strong>
                  {currentWallet.currency} {(currentWallet.balance - amount).toFixed(2)}
                </strong>
              </p>
            )}
          </div>

          {/* Description */}
          <div style={{ marginBottom: '1.5rem' }}>
            <label htmlFor="transfer-desc">Transfer Description / Reason</label>
            <input
              id="transfer-desc"
              type="text"
              placeholder="e.g. Invoice payment, monthly allowance"
              value={description}
              onChange={e => setDescription(e.target.value)}
              aria-invalid={!!fieldErrors.description}
            />
            {fieldErrors.description && (
              <p style={{ color: 'var(--danger)', fontSize: '0.75rem', marginTop: '0.25rem' }}>
                {fieldErrors.description}
              </p>
            )}
          </div>

          {/* Submit */}
          <button
            type="submit"
            className="btn-primary"
            style={{ width: '100%', padding: '0.75rem' }}
            disabled={wallets.length === 0 || beneficiaries.length === 0}
          >
            Review & Confirm Transfer →
          </button>
        </form>
      ) : (
        /* Confirmation Step */
        <div>
          <div
            style={{
              backgroundColor: '#f0fdf4',
              border: '1px solid #bbf7d0',
              borderRadius: 'var(--radius-md)',
              padding: '1rem',
              marginBottom: '1.25rem',
              color: '#166534',
              fontSize: '0.875rem',
            }}
          >
            🔍 <strong>Please Review Transfer Details</strong>
          </div>

          <div
            style={{
              backgroundColor: 'var(--gray-50)',
              border: '1px solid var(--gray-200)',
              borderRadius: 'var(--radius-md)',
              padding: '1.25rem',
              marginBottom: '1.5rem',
              lineHeight: '2',
              fontSize: '0.875rem',
            }}
          >
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--gray-200)',
                paddingBottom: '0.5rem',
              }}
            >
              <span style={{ color: 'var(--gray-600)' }}>Recipient Name:</span>
              <strong>{currentBeneficiary?.name}</strong>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--gray-200)',
                padding: '0.5rem 0',
              }}
            >
              <span style={{ color: 'var(--gray-600)' }}>Bank & Account:</span>
              <span>
                {currentBeneficiary?.bankName} (<code>{currentBeneficiary?.accountNumber}</code>)
              </span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--gray-200)',
                padding: '0.5rem 0',
              }}
            >
              <span style={{ color: 'var(--gray-600)' }}>Transfer Amount:</span>
              <strong style={{ fontSize: '1.125rem', color: 'var(--danger)' }}>
                -{currentWallet?.currency} {amount.toFixed(2)}
              </strong>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--gray-200)',
                padding: '0.5rem 0',
              }}
            >
              <span style={{ color: 'var(--gray-600)' }}>Processing Fee (Simulated):</span>
              <span style={{ color: 'var(--success)' }}>$0.00 FREE</span>
            </div>
            <div
              style={{
                display: 'flex',
                justifyContent: 'space-between',
                borderBottom: '1px solid var(--gray-200)',
                padding: '0.5rem 0',
              }}
            >
              <span style={{ color: 'var(--gray-600)' }}>Description:</span>
              <span>{description}</span>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', paddingTop: '0.5rem' }}>
              <span style={{ color: 'var(--gray-600)' }}>Projected Balance:</span>
              <strong>
                {currentWallet?.currency}{' '}
                {(currentWallet ? currentWallet.balance - amount : 0).toFixed(2)}
              </strong>
            </div>
          </div>

          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setStep('edit')}
              disabled={loading}
              style={{ flex: 1 }}
            >
              ← Edit Details
            </button>
            <button
              type="button"
              className="btn-primary"
              onClick={handleAuthorizeTransfer}
              disabled={loading}
              style={{ flex: 2 }}
            >
              {loading ? 'Authorizing & Debiting...' : 'Confirm & Authorize Transfer'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
