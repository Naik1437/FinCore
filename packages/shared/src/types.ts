import { z } from 'zod';

export const CurrencySchema = z.string().length(3);
export type Currency = z.infer<typeof CurrencySchema>;

export const WalletSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  currency: CurrencySchema,
  balance: z.number().nonnegative(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Wallet = z.infer<typeof WalletSchema>;

export const CreateWalletSchema = z.object({
  userId: z.string().uuid(),
  currency: CurrencySchema.default('USD'),
  initialBalance: z.number().nonnegative().default(0),
});
export type CreateWallet = z.infer<typeof CreateWalletSchema>;

export const TransactionTypeSchema = z.enum(['deposit', 'withdrawal', 'transfer', 'payment']);
export type TransactionType = z.infer<typeof TransactionTypeSchema>;

export const TransactionStatusSchema = z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']);
export type TransactionStatus = z.infer<typeof TransactionStatusSchema>;

export const TransactionSchema = z.object({
  id: z.string().uuid(),
  walletId: z.string().uuid(),
  type: TransactionTypeSchema,
  amount: z.number().positive(),
  currency: CurrencySchema,
  status: TransactionStatusSchema,
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Transaction = z.infer<typeof TransactionSchema>;

export const CreateTransactionSchema = z.object({
  walletId: z.string().uuid(),
  type: TransactionTypeSchema,
  amount: z.number().positive(),
  currency: CurrencySchema.default('USD'),
  description: z.string().optional(),
  metadata: z.record(z.unknown()).optional(),
});
export type CreateTransaction = z.infer<typeof CreateTransactionSchema>;

export const LedgerEntryTypeSchema = z.enum(['debit', 'credit']);
export type LedgerEntryType = z.infer<typeof LedgerEntryTypeSchema>;

export const LedgerEntrySchema = z.object({
  id: z.string().uuid(),
  walletId: z.string().uuid(),
  transactionId: z.string().uuid(),
  entryType: LedgerEntryTypeSchema,
  amount: z.number().positive(),
  currency: CurrencySchema,
  balanceAfter: z.number(),
  description: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const CreateLedgerEntrySchema = z.object({
  walletId: z.string().uuid(),
  transactionId: z.string().uuid(),
  entryType: LedgerEntryTypeSchema,
  amount: z.number().positive(),
  currency: CurrencySchema.default('USD'),
  description: z.string().optional(),
});
export type CreateLedgerEntry = z.infer<typeof CreateLedgerEntrySchema>;

export const PaginationSchema = z.object({
  page: z.number().positive().default(1),
  limit: z.number().positive().max(100).default(20),
});
export type Pagination = z.infer<typeof PaginationSchema>;

export const PaginatedResponseSchema = <T extends z.ZodTypeAny>(itemSchema: T) =>
  z.object({
    items: z.array(itemSchema),
    pagination: z.object({
      page: z.number().positive(),
      limit: z.number().positive(),
      total: z.number().nonnegative(),
      totalPages: z.number().nonnegative(),
    }),
  });

export const HealthCheckSchema = z.object({
  status: z.enum(['healthy', 'degraded', 'unhealthy']),
  timestamp: z.string().datetime(),
  uptime: z.number(),
  environment: z.string(),
  version: z.string(),
  services: z.record(z.enum(['healthy', 'unhealthy', 'unknown'])),
});
export type HealthCheck = z.infer<typeof HealthCheckSchema>;

export const ApiErrorSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.unknown().optional(),
  statusCode: z.number().int().positive(),
});
export type ApiError = z.infer<typeof ApiErrorSchema>;