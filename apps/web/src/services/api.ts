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
  User,
  Wallet,
} from '../types';

const BASE_URL =
  (typeof window === 'undefined' ? process.env.INTERNAL_API_URL : null) ||
  process.env.NEXT_PUBLIC_API_URL ||
  'http://localhost:4000';

let currentAuthToken: string | null = null;

export function setAuthToken(token: string | null): void {
  currentAuthToken = token;
  if (typeof window !== 'undefined') {
    if (token) {
      localStorage.setItem('fincore_access_token', token);
    } else {
      localStorage.removeItem('fincore_access_token');
    }
  }
}

export function getAuthToken(): string | null {
  if (currentAuthToken) return currentAuthToken;
  if (typeof window !== 'undefined') {
    currentAuthToken = localStorage.getItem('fincore_access_token');
  }
  return currentAuthToken;
}

async function fetchJson<T>(url: string, options?: RequestInit): Promise<T> {
  const finalUrl = typeof window === 'undefined' ? `${BASE_URL}${url}` : url;
  const token = getAuthToken();

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options?.headers as Record<string, string>),
  };

  const isPublicAuthEndpoint =
    url === '/api/auth/login' ||
    url === '/api/auth/mfa/challenge' ||
    url === '/api/auth/refresh' ||
    url === '/api/auth/register';

  if (token && !headers['Authorization'] && !isPublicAuthEndpoint) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(finalUrl, {
    ...options,
    headers,
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
  // Authentication & Identity
  async login(
    email: string,
    password: string
  ): Promise<{
    user?: User;
    accessToken?: string;
    refreshToken?: string;
    mfaRequired?: boolean;
    mfaToken?: string;
  }> {
    const data = await fetchJson<{
      user?: User;
      accessToken?: string;
      refreshToken?: string;
      mfaRequired?: boolean;
      mfaToken?: string;
    }>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    });
    if (data.accessToken) {
      setAuthToken(data.accessToken);
    }
    return data;
  },

  async mfaChallenge(
    mfaToken: string,
    code: string
  ): Promise<{
    user: User;
    accessToken: string;
    refreshToken: string;
  }> {
    const data = await fetchJson<{
      user: User;
      accessToken: string;
      refreshToken: string;
    }>('/api/auth/mfa/challenge', {
      method: 'POST',
      body: JSON.stringify({ mfaToken, code }),
    });
    if (data.accessToken) {
      setAuthToken(data.accessToken);
    }
    return data;
  },

  async mfaSetup(): Promise<{
    secret: string;
    backupCodes: string[];
    otpauthUrl: string;
    demoCode: string;
  }> {
    return await fetchJson('/api/auth/mfa/setup', { method: 'POST' });
  },

  async mfaVerify(code: string): Promise<{ success: boolean; message: string }> {
    return await fetchJson('/api/auth/mfa/verify', {
      method: 'POST',
      body: JSON.stringify({ code }),
    });
  },

  async logout(): Promise<void> {
    try {
      await fetchJson('/api/auth/logout', { method: 'POST' });
    } finally {
      setAuthToken(null);
    }
  },

  async getMe(): Promise<{ user: User; wallets: Wallet[] }> {
    return await fetchJson<{ user: User; wallets: Wallet[] }>('/api/auth/me');
  },

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
