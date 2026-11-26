import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const walletRouter = Router();

const createWalletSchema = z.object({
  body: z.object({
    userId: z.string().uuid('Invalid user UUID format'),
    currency: z.string().length(3, 'Currency must be a 3-letter ISO code').default('USD'),
    initialBalance: z.number().nonnegative('Initial balance cannot be negative').default(0),
  }),
});

const walletParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid wallet UUID format'),
  }),
});

const updateWalletStatusSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid wallet UUID format'),
  }),
  body: z.object({
    status: z.enum(['active', 'inactive', 'frozen', 'closed']),
    reason: z.string().optional(),
  }),
});

const listWalletsSchema = z.object({
  query: z.object({
    userId: z.string().uuid().optional(),
    currency: z.string().length(3).optional(),
    status: z.enum(['active', 'inactive', 'frozen', 'closed']).optional(),
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(50),
  }),
});

walletRouter.post('/', validateRequest(createWalletSchema), async (req, res: Response) => {
  const { userId, currency, initialBalance } = req.body as {
    userId: string;
    currency: string;
    initialBalance: number;
  };
  if (req.user?.role === 'customer' && (req.user.id !== userId || initialBalance !== 0)) {
    return res.status(403).json({ error: 'Customers can open only their own unfunded wallets' });
  }

  try {
    // Verify user exists
    const userRes = await pool.query('SELECT id FROM users WHERE id = $1', [userId]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'User account not found', statusCode: 404 });
    }

    const result = await pool.query(
      'INSERT INTO wallets (user_id, currency, balance, status) VALUES ($1, $2, $3::numeric(18, 4), $4) RETURNING *',
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
        updatedAt: row.updated_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to create wallet', statusCode: 500 });
  }
});

walletRouter.get('/:id', validateRequest(walletParamsSchema), async (req, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM wallets WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found', statusCode: 404 });
    }
    const row = result.rows[0];

    // Resource ownership authorization
    if (req.user && req.user.role === 'customer' && row.user_id !== req.user.id) {
      return res.status(403).json({
        error: 'Forbidden',
        message: 'Access denied: You do not own this wallet',
        statusCode: 403,
      });
    }

    res.json({
      wallet: {
        id: row.id,
        userId: row.user_id,
        currency: row.currency.trim(),
        balance: parseFloat(row.balance),
        heldBalance: parseFloat(row.held_balance || 0),
        held_balance: parseFloat(row.held_balance || 0),
        status: row.status,
        version: row.version,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch wallet', statusCode: 500 });
  }
});

walletRouter.patch(
  '/:id/status',
  validateRequest(updateWalletStatusSchema),
  async (req, res: Response) => {
    try {
      const { id } = req.params;
      const { status, reason } = req.body;

      // Role check: customers cannot freeze or change wallet status
      if (req.user && req.user.role === 'customer') {
        return res.status(403).json({
          error: 'Forbidden',
          message: 'Only administrative staff may modify wallet status',
          statusCode: 403,
        });
      }

      const currentRes = await pool.query('SELECT * FROM wallets WHERE id = $1', [id]);
      if (currentRes.rows.length === 0) {
        return res.status(404).json({ error: 'Wallet not found', statusCode: 404 });
      }

      const current = currentRes.rows[0];
      if (current.status === 'closed') {
        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: 'Closed wallets cannot change status',
          statusCode: 422,
        });
      }

      const result = await pool.query(
        'UPDATE wallets SET status = $1, version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [status, id]
      );
      const row = result.rows[0];

      res.json({
        message: `Wallet status updated to ${status}`,
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
        audit: {
          previousStatus: current.status,
          newStatus: status,
          reason: reason || 'Administrative update',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to update wallet status', statusCode: 500 });
    }
  }
);

walletRouter.patch(
  '/:id',
  validateRequest(updateWalletStatusSchema),
  async (req, res: Response) => {
    // Alias for PATCH /:id/status for REST convenience
    try {
      const { id } = req.params;
      const { status, reason } = req.body;

      const currentRes = await pool.query('SELECT * FROM wallets WHERE id = $1', [id]);
      if (currentRes.rows.length === 0) {
        return res.status(404).json({ error: 'Wallet not found', statusCode: 404 });
      }

      const current = currentRes.rows[0];
      if (current.status === 'closed') {
        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: 'Closed wallets cannot change status',
          statusCode: 422,
        });
      }

      const result = await pool.query(
        'UPDATE wallets SET status = $1, version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING *',
        [status, id]
      );
      const row = result.rows[0];

      res.json({
        message: `Wallet status updated to ${status}`,
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
        audit: {
          previousStatus: current.status,
          newStatus: status,
          reason: reason || 'Administrative update',
          timestamp: new Date().toISOString(),
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to update wallet status', statusCode: 500 });
    }
  }
);

walletRouter.get('/', validateRequest(listWalletsSchema), async (req, res: Response) => {
  try {
    const { userId, currency, status, page = 1, limit = 50 } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    let countQuery = 'SELECT COUNT(*) as count FROM wallets WHERE 1=1';
    let dataQuery = 'SELECT * FROM wallets WHERE 1=1';
    const params: any[] = [];

    const targetUserId = req.user && req.user.role === 'customer' ? req.user.id : userId;
    if (targetUserId) {
      params.push(targetUserId);
      const clause = ` AND user_id = $${params.length}`;
      countQuery += clause;
      dataQuery += clause;
    }
    if (currency) {
      params.push(currency.toUpperCase());
      const clause = ` AND currency = $${params.length}`;
      countQuery += clause;
      dataQuery += clause;
    }
    if (status) {
      params.push(status);
      const clause = ` AND status = $${params.length}`;
      countQuery += clause;
      dataQuery += clause;
    }

    const countRes = await pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    params.push(Number(limit));
    dataQuery += ` ORDER BY created_at ASC LIMIT $${params.length}`;
    params.push(offset);
    dataQuery += ` OFFSET $${params.length}`;

    const result = await pool.query(dataQuery, params);

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
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)) || 1,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch wallets', statusCode: 500 });
  }
});
