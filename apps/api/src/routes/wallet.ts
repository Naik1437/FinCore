import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

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
  try {
    const result = await pool.query(
      'INSERT INTO wallets (user_id, currency, balance, status) VALUES ($1, $2, $3, $4) RETURNING *',
      [userId, currency.toUpperCase(), initialBalance, 'active']
    );
    const row = result.rows[0];
    res.status(201).json({
      message: 'Wallet created',
      wallet: {
        id: row.id,
        userId: row.user_id,
        currency: row.currency.trim(),
        balance: parseFloat(row.balance),
        status: row.status,
        version: row.version,
        createdAt: row.created_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to create wallet' });
  }
});

walletRouter.get('/:id', validateRequest(walletParamsSchema), async (req, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM wallets WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    const row = result.rows[0];
    res.json({
      wallet: {
        id: row.id,
        userId: row.user_id,
        currency: row.currency.trim(),
        balance: parseFloat(row.balance),
        status: row.status,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch wallet' });
  }
});

walletRouter.get('/', async (_req, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM wallets ORDER BY created_at ASC');
    res.json({
      wallets: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        currency: row.currency.trim(),
        balance: parseFloat(row.balance),
        status: row.status,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: { page: 1, limit: 20, total: result.rowCount },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch wallets' });
  }
});
