'use client';

import { useCallback, useEffect, useState } from 'react';
import { AuthModal } from '../components/AuthModal';
import { BeneficiaryManager } from '../components/BeneficiaryManager';
import { DisputeManager } from '../components/DisputeManager';
import { DisputeModal } from '../components/DisputeModal';
import { Header } from '../components/Header';
import { OperationsConsole } from '../components/OperationsConsole';
import { SimulatedBanner } from '../components/SimulatedBanner';
import { StatementViewer } from '../components/StatementViewer';
import { TransactionList } from '../components/TransactionList';
import { TransferForm } from '../components/TransferForm';
import { WalletCard } from '../components/WalletCard';
import { api } from '../services/api';
import type { Beneficiary, Dispute, Transaction, User, Wallet } from '../types';

export default function Home() {
  const [role, setRole] = useState<'customer' | 'operations'>('customer');
  const [activeTab, setActiveTab] = useState<string>('overview');
  const [currentUser, setCurrentUser] = useState<User | null>(null);
  const [isAuthModalOpen, setIsAuthModalOpen] = useState<boolean>(false);

  // State
  const [wallets, setWallets] = useState<Wallet[]>([]);
  const [beneficiaries, setBeneficiaries] = useState<Beneficiary[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [disputes, setDisputes] = useState<Dispute[]>([]);
  const [selectedWalletId, setSelectedWalletId] = useState<string>('');
  const [disputingTxn, setDisputingTxn] = useState<Transaction | null>(null);

  const [loading, setLoading] = useState<boolean>(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [walletData, benData, txData, disputeData] = await Promise.all([
        api.getWallets(),
        api.getBeneficiaries(),
        api.getTransactions(),
        api.getDisputes(),
      ]);

      setWallets(walletData);
      setSelectedWalletId(prev =>
        prev && walletData.some(w => w.id === prev)
          ? prev
          : walletData.length > 0
            ? walletData[0].id
            : ''
      );
      setBeneficiaries(benData);
      setTransactions(txData);
      setDisputes(disputeData);
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : 'Failed to load financial data from backend API.'
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const selectedWallet = wallets.find(w => w.id === selectedWalletId) || wallets[0];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <SimulatedBanner />
      <Header
        currentRole={role}
        onRoleChange={newRole => {
          setRole(newRole);
          if (newRole === 'operations') {
            setActiveTab('operations');
          } else if (activeTab === 'operations') {
            setActiveTab('overview');
          }
        }}
        activeTab={activeTab}
        onTabChange={tab => setActiveTab(tab)}
        currentUser={currentUser}
        onOpenAuth={() => setIsAuthModalOpen(true)}
      />

      <AuthModal
        isOpen={isAuthModalOpen}
        onClose={() => setIsAuthModalOpen(false)}
        currentUser={currentUser}
        onAuthSuccess={user => {
          setCurrentUser(user);
          setSelectedWalletId('');
          if (user.role !== 'customer') {
            setRole('operations');
            setActiveTab('operations');
          } else {
            setRole('customer');
            setActiveTab('overview');
          }
          void fetchData();
        }}
        onLogout={() => {
          void api.logout();
          setCurrentUser(null);
          setRole('customer');
          setActiveTab('overview');
          void fetchData();
        }}
      />

      <main className="container" style={{ flex: 1, paddingBottom: '3rem' }}>
        {error && (
          <div
            style={{
              background: '#fef2f2',
              border: '1px solid #ef4444',
              borderRadius: '8px',
              padding: '1rem',
              marginBottom: '1.5rem',
              color: '#991b1b',
            }}
          >
            <strong>Connection Notice:</strong> {error}
            <div style={{ marginTop: '0.5rem' }}>
              <button
                className="btn btn-secondary"
                onClick={() => fetchData()}
                style={{ fontSize: '0.8rem' }}
              >
                Retry Connection
              </button>
            </div>
          </div>
        )}

        {/* OPERATIONS VIEW */}
        {role === 'operations' || activeTab === 'operations' ? (
          <OperationsConsole onRefreshNeeded={fetchData} />
        ) : (
          /* CUSTOMER VIEW */
          <div>
            {/* OVERVIEW TAB */}
            {activeTab === 'overview' && (
              <div>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    marginBottom: '1rem',
                  }}
                >
                  <div>
                    <h2 style={{ fontSize: '1.5rem', fontWeight: 700, margin: 0 }}>
                      Simulated Multi-Currency Wallets
                    </h2>
                    <p
                      style={{
                        margin: '0.25rem 0 0 0',
                        color: 'var(--text-muted)',
                        fontSize: '0.9rem',
                      }}
                    >
                      Real-time synthetic balances backed by double-entry ledger entries.
                    </p>
                  </div>
                  <div style={{ display: 'flex', gap: '0.5rem' }}>
                    <button
                      className="btn btn-secondary"
                      onClick={() => fetchData()}
                      disabled={loading}
                      style={{ fontSize: '0.85rem' }}
                    >
                      🔄 Refresh Balances
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() => setActiveTab('transfers')}
                      style={{ fontSize: '0.85rem' }}
                    >
                      💸 Send Money
                    </button>
                  </div>
                </div>

                {loading && wallets.length === 0 ? (
                  <div style={{ textAlign: 'center', padding: '3rem', color: 'var(--text-muted)' }}>
                    Connecting to FinCore API and Ledger...
                  </div>
                ) : (
                  <>
                    <div className="grid grid-2" style={{ marginBottom: '2rem' }}>
                      {wallets.map(wallet => (
                        <WalletCard
                          key={wallet.id}
                          wallet={wallet}
                          onSendTransfer={id => {
                            setSelectedWalletId(id);
                            setActiveTab('transfers');
                          }}
                          onViewStatement={id => {
                            setSelectedWalletId(id);
                            setActiveTab('statements');
                          }}
                        />
                      ))}
                    </div>

                    <div style={{ marginTop: '2rem' }}>
                      <TransactionList
                        transactions={transactions}
                        loading={loading}
                        onDisputeClick={txn => setDisputingTxn(txn)}
                      />
                    </div>
                  </>
                )}
              </div>
            )}

            {/* TRANSFERS TAB */}
            {activeTab === 'transfers' && (
              <div style={{ maxWidth: '720px', margin: '0 auto' }}>
                <TransferForm
                  wallets={wallets}
                  beneficiaries={beneficiaries}
                  selectedWalletId={selectedWalletId}
                  onTransferSuccess={(_txn, _newBalance) => {
                    void fetchData();
                  }}
                  onCloseReceipt={() => {
                    setActiveTab('transactions');
                  }}
                  onNavigateToBeneficiaries={() => setActiveTab('beneficiaries')}
                />
              </div>
            )}

            {/* TRANSACTIONS TAB */}
            {activeTab === 'transactions' && (
              <div>
                <TransactionList
                  transactions={transactions}
                  loading={loading}
                  onDisputeClick={txn => setDisputingTxn(txn)}
                />
              </div>
            )}

            {/* BENEFICIARIES TAB */}
            {activeTab === 'beneficiaries' && (
              <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                <BeneficiaryManager
                  beneficiaries={beneficiaries}
                  onBeneficiariesChange={() => {
                    void fetchData();
                  }}
                  onSelectForTransfer={_b => {
                    setActiveTab('transfers');
                  }}
                />
              </div>
            )}

            {/* DISPUTES TAB */}
            {activeTab === 'disputes' && (
              <div style={{ maxWidth: '800px', margin: '0 auto' }}>
                <DisputeManager disputes={disputes} loading={loading} />
              </div>
            )}

            {/* STATEMENTS TAB */}
            {activeTab === 'statements' && (
              <div>
                <StatementViewer wallets={wallets} selectedWalletId={selectedWallet?.id} />
              </div>
            )}
          </div>
        )}

        {/* Dispute Modal */}
        {disputingTxn && (
          <DisputeModal
            transaction={disputingTxn}
            onClose={() => setDisputingTxn(null)}
            onDisputeCreated={() => {
              setDisputingTxn(null);
              fetchData();
              setActiveTab('disputes');
            }}
          />
        )}
      </main>

      <footer
        style={{
          borderTop: '1px solid var(--border)',
          padding: '1.5rem 0',
          background: 'white',
          marginTop: 'auto',
        }}
      >
        <div
          className="container"
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            fontSize: '0.85rem',
            color: 'var(--text-muted)',
            flexWrap: 'wrap',
            gap: '1rem',
          }}
        >
          <div>
            <strong>FinCore</strong> • Assessment 01: Financial Customer Frontend
          </div>
          <div style={{ display: 'flex', gap: '1rem' }}>
            <span>
              Backend: <code>localhost:4000</code>
            </span>
            <span>
              Ledger: <code>Synchronized</code>
            </span>
            <span>
              Environment: <strong>SIMULATION / TESTNET</strong>
            </span>
          </div>
        </div>
      </footer>
    </div>
  );
}
