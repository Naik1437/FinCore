export type WalletStatus = 'active' | 'inactive' | 'frozen' | 'closed';
export type TransactionType = 'deposit' | 'withdrawal' | 'transfer' | 'payment';
export type TransactionStatus = 'pending' | 'processing' | 'completed' | 'failed' | 'cancelled';
export type DisputeStatus = 'pending_review' | 'under_investigation' | 'resolved' | 'rejected';
export type LedgerEntryType = 'debit' | 'credit';

export interface Wallet {
  id: string;
  userId: string;
  currency: string;
  balance: number;
  status: WalletStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
}

export interface Beneficiary {
  id: string;
  userId: string;
  name: string;
  accountNumber: string;
  routingNumber?: string | null;
  bankName: string;
  currency: string;
  status: string;
  createdAt: string;
}

export interface Transaction {
  id: string;
  walletId: string;
  type: TransactionType;
  amount: number;
  currency: string;
  status: TransactionStatus;
  description?: string;
  metadata?: Record<string, unknown>;
  createdAt: string;
  updatedAt?: string;
}

export interface Dispute {
  id: string;
  transactionId: string;
  userId: string;
  reason: string;
  details: string;
  status: DisputeStatus;
  resolutionNotes?: string | null;
  createdAt: string;
  transaction?: {
    amount: number;
    currency: string;
    type: string;
    description?: string;
  };
}

export interface StatementSummary {
  totalDebits: number;
  totalCredits: number;
  netFlow: number;
  transactionCount: number;
}

export interface Statement {
  statementId: string;
  generatedAt: string;
  period: {
    start: string;
    end: string;
  };
  wallet: {
    id: string;
    currency: string;
    currentBalance: number;
    simulated: boolean;
  };
  summary: StatementSummary;
  transactions: Array<{
    id: string;
    type: TransactionType;
    amount: number;
    currency: string;
    status: TransactionStatus;
    description?: string;
    createdAt: string;
  }>;
}

export interface OperationsSummary {
  activeWallets: number;
  totalTransactions: number;
  totalVolume: number;
  pendingTransactions: number;
  failedTransactions: number;
  totalDisputes: number;
  openDisputes: number;
  immutableLedgerEntries: number;
}

export interface LedgerEntry {
  id: string;
  walletId: string;
  transactionId: string;
  entryType: LedgerEntryType;
  amount: number;
  currency: string;
  balanceAfter: number;
  description?: string;
  createdAt: string;
}

export interface CreateBeneficiaryPayload {
  name: string;
  accountNumber: string;
  routingNumber?: string;
  bankName: string;
  currency: string;
}

export interface CreateTransferPayload {
  sourceWalletId: string;
  beneficiaryId: string;
  amount: number;
  description: string;
  idempotencyKey?: string;
}

export interface CreateDisputePayload {
  transactionId: string;
  reason: string;
  details: string;
}
