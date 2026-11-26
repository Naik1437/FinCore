import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const accountRouter = Router();

const createAccountSchema = z.object({
  body: z.object({
    email: z.string().email('Invalid email address format'),
    fullName: z.string().min(2, 'Full name must be at least 2 characters'),
    phone: z.string().optional(),
  }),
});

const updateAccountSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid account UUID format'),
  }),
  body: z.object({
    fullName: z.string().min(2).optional(),
    phone: z.string().optional(),
    isVerified: z.boolean().optional(),
  }),
});

const accountParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid account UUID format'),
  }),
});

const listAccountsSchema = z.object({
  query: z.object({
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(20),
    search: z.string().optional(),
  }),
});

accountRouter.get('/', validateRequest(listAccountsSchema), async (req, res: Response) => {
  try {
    const { page = 1, limit = 20, search } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    let countQuery = 'SELECT COUNT(*) as count FROM users WHERE 1=1';
    let dataQuery = 'SELECT * FROM users WHERE 1=1';
    const params: any[] = [];

    if (search) {
      params.push(`%${search}%`);
      const clause = ` AND (email ILIKE $${params.length} OR full_name ILIKE $${params.length})`;
      countQuery += clause;
      dataQuery += clause;
    }

    const countRes = await pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    params.push(Number(limit));
    dataQuery += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    params.push(offset);
    dataQuery += ` OFFSET $${params.length}`;

    const dataRes = await pool.query(dataQuery, params);

    res.json({
      accounts: dataRes.rows.map(row => ({
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phone: row.phone,
        isVerified: row.is_verified,
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
    res.status(500).json({ error: 'Failed to fetch accounts' });
  }
});

accountRouter.get('/:id', validateRequest(accountParamsSchema), async (req, res: Response) => {
  try {
    const { id } = req.params;
    const userRes = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (userRes.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found', statusCode: 404 });
    }

    const user = userRes.rows[0];
    const walletsRes = await pool.query(
      'SELECT * FROM wallets WHERE user_id = $1 ORDER BY currency ASC',
      [id]
    );

    res.json({
      account: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        isVerified: user.is_verified,
        createdAt: user.created_at,
        updatedAt: user.updated_at,
        wallets: walletsRes.rows.map(w => ({
          id: w.id,
          currency: w.currency.trim(),
          balance: parseFloat(w.balance),
          status: w.status,
          createdAt: w.created_at,
        })),
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch account', statusCode: 500 });
  }
});

accountRouter.post('/', validateRequest(createAccountSchema), async (req, res: Response) => {
  const { email, fullName, phone } = req.body;
  try {
    const existing = await pool.query(
      'SELECT id FROM users WHERE email = $1 OR (phone IS NOT NULL AND phone = $2)',
      [email, phone || '']
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email or phone number already exists',
        statusCode: 409,
      });
    }

    const result = await pool.query(
      `INSERT INTO users (email, full_name, phone, is_verified)
       VALUES ($1, $2, $3, false)
       RETURNING *`,
      [email, fullName, phone || null]
    );
    const row = result.rows[0];

    res.status(201).json({
      message: 'Account created successfully',
      account: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phone: row.phone,
        isVerified: row.is_verified,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to create account', statusCode: 500 });
  }
});

accountRouter.patch('/:id', validateRequest(updateAccountSchema), async (req, res: Response) => {
  const { id } = req.params;
  const { fullName, phone, isVerified } = req.body;

  try {
    const checkRes = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
    if (checkRes.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found', statusCode: 404 });
    }

    const updates: string[] = [];
    const params: any[] = [];

    if (fullName !== undefined) {
      params.push(fullName);
      updates.push(`full_name = $${params.length}`);
    }
    if (phone !== undefined) {
      params.push(phone);
      updates.push(`phone = $${params.length}`);
    }
    if (isVerified !== undefined) {
      params.push(isVerified);
      updates.push(`is_verified = $${params.length}`);
    }

    if (updates.length === 0) {
      return res.status(400).json({ error: 'No fields provided for update', statusCode: 400 });
    }

    params.push(id);
    const query = `UPDATE users SET ${updates.join(', ')}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`;
    const result = await pool.query(query, params);
    const row = result.rows[0];

    res.json({
      message: 'Account updated successfully',
      account: {
        id: row.id,
        email: row.email,
        fullName: row.full_name,
        phone: row.phone,
        isVerified: row.is_verified,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to update account', statusCode: 500 });
  }
});
