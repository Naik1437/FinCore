import { Response, Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';

export const ledgerRouter = Router();

const ledgerEntrySchema = z.object({
  body: z.object({
    walletId: z.string().uuid(),
    transactionId: z.string().uuid(),
    entryType: z.enum(['debit', 'credit']),
    amount: z.number().positive(),
    currency: z.string().length(3).default('USD'),
    description: z.string().optional(),
  }),
});

const ledgerParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

const listLedgerSchema = z.object({
  query: z.object({
    walletId: z.string().uuid().optional(),
    entryType: z.enum(['debit', 'credit']).optional(),
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(20),
  }),
});

ledgerRouter.post('/', validateRequest(ledgerEntrySchema), async (req, res: Response) => {
  res.status(201).json({
    message: 'Ledger entry created',
    entry: {
      id: 'ledger-id-placeholder',
      ...req.body,
      balanceAfter: 100.0,
      createdAt: new Date().toISOString(),
    },
  });
});

ledgerRouter.get('/:id', validateRequest(ledgerParamsSchema), async (req, res: Response) => {
  res.json({
    entry: {
      id: req.params.id,
      walletId: 'wallet-id-placeholder',
      transactionId: 'txn-id-placeholder',
      entryType: 'credit',
      amount: 100.0,
      currency: 'USD',
      balanceAfter: 100.0,
      description: 'Initial deposit',
      createdAt: new Date().toISOString(),
    },
  });
});

ledgerRouter.get('/', validateRequest(listLedgerSchema), async (req, res: Response) => {
  res.json({
    entries: [],
    pagination: { page: req.query.page, limit: req.query.limit, total: 0 },
  });
});

ledgerRouter.get('/wallet/:walletId/balance', async (req, res: Response) => {
  res.json({
    walletId: req.params.walletId,
    balance: 100.0,
    currency: 'USD',
    lastUpdated: new Date().toISOString(),
  });
});
