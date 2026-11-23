import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';

export const transactionRouter = Router();

const createTransactionSchema = z.object({
  body: z.object({
    walletId: z.string().uuid(),
    type: z.enum(['deposit', 'withdrawal', 'transfer', 'payment']),
    amount: z.number().positive(),
    currency: z.string().length(3).default('USD'),
    description: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

const transactionParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

const listTransactionsSchema = z.object({
  query: z.object({
    walletId: z.string().uuid().optional(),
    type: z.enum(['deposit', 'withdrawal', 'transfer', 'payment']).optional(),
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(20),
  }),
});

transactionRouter.post(
  '/',
  validateRequest(createTransactionSchema),
  async (req, res: Response) => {
    res.status(201).json({
      message: 'Transaction created',
      transaction: {
        id: 'txn-id-placeholder',
        ...req.body,
        status: 'pending',
        createdAt: new Date().toISOString(),
      },
    });
  }
);

transactionRouter.get(
  '/:id',
  validateRequest(transactionParamsSchema),
  async (req, res: Response) => {
    res.json({
      transaction: {
        id: req.params.id,
        walletId: 'wallet-id-placeholder',
        type: 'deposit',
        amount: 100.0,
        currency: 'USD',
        status: 'completed',
        description: 'Test transaction',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      },
    });
  }
);

transactionRouter.get('/', validateRequest(listTransactionsSchema), async (req, res: Response) => {
  res.json({
    transactions: [],
    pagination: { page: req.query.page, limit: req.query.limit, total: 0 },
  });
});
