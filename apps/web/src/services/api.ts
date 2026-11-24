import type {
  Beneficiary,
  CreateBeneficiaryPayload,
  CreateDisputePayload,
  CreateTransferPayload,
  Dispute,
  LedgerEntry,
  OperationsSummary,
  Statement,
  Transaction,
  Wallet,
} from '../types';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const finalUrl = typeof window === 'undefined' ? `${BASE_URL}${url}` : url;
  const res = await fetch(finalUrl, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...options?.headers,
    },
  });

  const data: unknown = await res.json().catch(() => ({}));

  if (!res.ok) {
    const record =
      typeof data === 'object' && data !== null ? (data as Record<string, unknown>) : {};
    const errorMsg =
      (typeof record.error === 'string' && record.error) ||
      (typeof record.message === 'string' && record.message) ||
      (typeof record.details === 'string' && record.details) ||
      `Request failed with status ${res.status}`;
    throw new Error(errorMsg);
  }

  return data as T;
}

export const api = {
  // Wallets
  async getWallets(): Promise<Wallet[]> {
    const data = await fetchJson<{ wallets: Wallet[] }>('/api/wallets');
    return data.wallets || [];
  },

  async getWallet(id: string): Promise<Wallet> {
    const data = await fetchJson<{ wallet: Wallet }>(`/api/wallets/${id}`);
    return data.wallet;
  },

  // Beneficiaries
  async getBeneficiaries(): Promise<Beneficiary[]> {
    const data = await fetchJson<{ beneficiaries: Beneficiary[] }>('/api/beneficiaries');
    return data.beneficiaries || [];
  },

  async createBeneficiary(payload: CreateBeneficiaryPayload): Promise<Beneficiary> {
    const data = await fetchJson<{ beneficiary: Beneficiary }>('/api/beneficiaries', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.beneficiary;
  },

  async deleteBeneficiary(id: string): Promise<void> {
    await fetchJson<{ message: string }>(`/api/beneficiaries/${id}`, {
      method: 'DELETE',
    });
  },

  // Transactions & Transfers
  async getTransactions(params?: {
    walletId?: string;
    status?: string;
    type?: string;
  }): Promise<Transaction[]> {
    const query = new URLSearchParams();
    if (params?.walletId) query.set('walletId', params.walletId);
    if (params?.status && params.status !== 'all') query.set('status', params.status);
    if (params?.type && params.type !== 'all') query.set('type', params.type);

    const queryString = query.toString() ? `?${query.toString()}` : '';
    const data = await fetchJson<{ transactions: Transaction[] }>(
      `/api/transactions${queryString}`
    );
    return data.transactions || [];
  },

  async createTransfer(
    payload: CreateTransferPayload
  ): Promise<{ transaction: Transaction; newBalance: number }> {
    return await fetchJson<{ transaction: Transaction; newBalance: number }>(
      '/api/transactions/transfer',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
  },

  // Disputes
  async getDisputes(): Promise<Dispute[]> {
    const data = await fetchJson<{ disputes: Dispute[] }>('/api/disputes');
    return data.disputes || [];
  },

  async createDispute(payload: CreateDisputePayload): Promise<Dispute> {
    const data = await fetchJson<{ dispute: Dispute }>('/api/disputes', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return data.dispute;
  },

  async updateDisputeStatus(
    id: string,
    status: string,
    resolutionNotes?: string
  ): Promise<Dispute> {
    const data = await fetchJson<{ dispute: Dispute }>(`/api/disputes/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status, resolutionNotes }),
    });
    return data.dispute;
  },

  // Statements & Reports
  async getStatement(walletId?: string): Promise<Statement> {
    const query = walletId ? `?walletId=${walletId}` : '';
    const data = await fetchJson<{ statement: Statement }>(`/api/reports/statement${query}`);
    return data.statement;
  },

  async getOperationsSummary(): Promise<OperationsSummary> {
    return await fetchJson<OperationsSummary>('/api/reports/summary');
  },

  // Ledger Audit Trail
  async getLedgerEntries(): Promise<LedgerEntry[]> {
    const data = await fetchJson<{ entries: LedgerEntry[] }>('/api/ledger');
    return data.entries || [];
  },
};
