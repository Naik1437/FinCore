import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';

export const walletRouter = Router();

const createWalletSchema = z.object({
  body: z.object({
    userId: z.string().uuid(),
    currency: z.string().length(3).default('USD'),
    initialBalance: z.number().nonnegative().default(0),
  }),
});

const walletParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

walletRouter.post('/', validateRequest(createWalletSchema), async (req, res: Response) => {
  const { userId, currency, initialBalance } = req.body as { userId: string; currency: string; initialBalance: number };
  res.status(201).json({
    message: 'Wallet created',
    wallet: {
      id: 'wallet-id-placeholder',
      userId,
      currency,
      balance: initialBalance,
      createdAt: new Date().toISOString(),
    },
  });
});

walletRouter.get('/:id', validateRequest(walletParamsSchema), async (req, res: Response) => {
  res.json({
    wallet: {
      id: req.params.id,
      userId: 'user-id-placeholder',
      currency: 'USD',
      balance: 100.0,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
  });
});

walletRouter.get('/', async (_req, res: Response) => {
  res.json({
    wallets: [],
    pagination: { page: 1, limit: 20, total: 0 },
  });
});
