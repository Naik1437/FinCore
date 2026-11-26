import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const beneficiaryRouter = Router();

const createBeneficiarySchema = z.object({
  body: z.object({
    userId: z.string().uuid().optional(),
    name: z.string().min(2, 'Name must be at least 2 characters'),
    accountNumber: z.string().min(4, 'Account number must be at least 4 characters'),
    routingNumber: z.string().optional(),
    bankName: z.string().min(2, 'Bank name is required'),
    currency: z.string().length(3, 'Currency must be 3 characters').default('USD'),
  }),
});

const updateBeneficiarySchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid beneficiary UUID format'),
  }),
  body: z.object({
    name: z.string().min(2).optional(),
    accountNumber: z.string().min(4).optional(),
    routingNumber: z.string().optional(),
    bankName: z.string().min(2).optional(),
    status: z.enum(['active', 'inactive']).optional(),
  }),
});

const beneficiaryParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid beneficiary UUID format'),
  }),
});

const listBeneficiariesSchema = z.object({
  query: z.object({
    currency: z.string().length(3).optional(),
    search: z.string().optional(),
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(50),
  }),
});

beneficiaryRouter.get('/', validateRequest(listBeneficiariesSchema), async (req, res: Response) => {
  try {
    const { currency, search, page = 1, limit = 50 } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    let countQuery = 'SELECT COUNT(*) as count FROM beneficiaries WHERE 1=1';
    let dataQuery = 'SELECT * FROM beneficiaries WHERE 1=1';
    const params: any[] = [];

    if (req.user?.role === 'customer') {
      params.push(req.user.id);
      countQuery += ' AND user_id = $1';
      dataQuery += ' AND user_id = $1';
    }
    if (currency) {
      params.push(currency.toUpperCase());
      const clause = ` AND currency = $${params.length}`;
      countQuery += clause;
      dataQuery += clause;
    }

    if (search) {
      params.push(`%${search}%`);
      const clause = ` AND (name ILIKE $${params.length} OR bank_name ILIKE $${params.length} OR account_number ILIKE $${params.length})`;
      countQuery += clause;
      dataQuery += clause;
    }

    const countRes = await pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    params.push(Number(limit));
    dataQuery += ` ORDER BY created_at DESC LIMIT $${params.length}`;
    params.push(offset);
    dataQuery += ` OFFSET $${params.length}`;

    const result = await pool.query(dataQuery, params);

    res.json({
      beneficiaries: result.rows.map(row => ({
        id: row.id,
        userId: row.user_id,
        name: row.name,
        accountNumber: row.account_number,
        routingNumber: row.routing_number,
        bankName: row.bank_name,
        currency: row.currency ? row.currency.trim() : 'USD',
        status: row.status,
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
    res.status(500).json({ error: 'Failed to fetch beneficiaries', statusCode: 500 });
  }
});

beneficiaryRouter.get(
  '/:id',
  validateRequest(beneficiaryParamsSchema),
  async (req, res: Response) => {
    try {
      const result = await pool.query('SELECT * FROM beneficiaries WHERE id = $1', [req.params.id]);
      if (
        result.rows.length === 0 ||
        (req.user?.role === 'customer' && result.rows[0].user_id !== req.user.id)
      ) {
        return res.status(404).json({ error: 'Beneficiary not found', statusCode: 404 });
      }
      const row = result.rows[0];
      res.json({
        beneficiary: {
          id: row.id,
          userId: row.user_id,
          name: row.name,
          accountNumber: row.account_number,
          routingNumber: row.routing_number,
          bankName: row.bank_name,
          currency: row.currency ? row.currency.trim() : 'USD',
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch beneficiary', statusCode: 500 });
    }
  }
);

beneficiaryRouter.post(
  '/',
  validateRequest(createBeneficiarySchema),
  async (req, res: Response) => {
    const { userId: bodyUserId, name, accountNumber, routingNumber, bankName, currency } = req.body;
    try {
      const userId = (req.user?.role !== 'customer' && bodyUserId) ? bodyUserId : req.user!.id;

      const result = await pool.query(
        `INSERT INTO beneficiaries (user_id, name, account_number, routing_number, bank_name, currency, status)
       VALUES ($1, $2, $3, $4, $5, $6, 'active')
       RETURNING *`,
        [userId, name, accountNumber, routingNumber || null, bankName, currency.toUpperCase()]
      );
      const row = result.rows[0];
      res.status(201).json({
        message: 'Beneficiary added successfully',
        beneficiary: {
          id: row.id,
          userId: row.user_id,
          name: row.name,
          accountNumber: row.account_number,
          routingNumber: row.routing_number,
          bankName: row.bank_name,
          currency: row.currency.trim(),
          status: row.status,
          createdAt: row.created_at,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to create beneficiary', statusCode: 500 });
    }
  }
);

beneficiaryRouter.patch(
  '/:id',
  validateRequest(updateBeneficiarySchema),
  async (req, res: Response) => {
    const { id } = req.params;
    const { name, accountNumber, routingNumber, bankName, status } = req.body;

    try {
      const checkRes = await pool.query('SELECT * FROM beneficiaries WHERE id = $1', [id]);
      if (
        checkRes.rows.length === 0 ||
        (req.user?.role === 'customer' && checkRes.rows[0].user_id !== req.user.id)
      ) {
        return res.status(404).json({ error: 'Beneficiary not found', statusCode: 404 });
      }

      const updates: string[] = [];
      const params: any[] = [];

      if (name !== undefined) {
        params.push(name);
        updates.push(`name = $${params.length}`);
      }
      if (accountNumber !== undefined) {
        params.push(accountNumber);
        updates.push(`account_number = $${params.length}`);
      }
      if (routingNumber !== undefined) {
        params.push(routingNumber);
        updates.push(`routing_number = $${params.length}`);
      }
      if (bankName !== undefined) {
        params.push(bankName);
        updates.push(`bank_name = $${params.length}`);
      }
      if (status !== undefined) {
        params.push(status);
        updates.push(`status = $${params.length}`);
      }

      if (updates.length === 0) {
        return res.status(400).json({ error: 'No fields provided to update', statusCode: 400 });
      }

      params.push(id);
      const query = `UPDATE beneficiaries SET ${updates.join(
        ', '
      )}, updated_at = NOW() WHERE id = $${params.length} RETURNING *`;
      const result = await pool.query(query, params);
      const row = result.rows[0];

      res.json({
        message: 'Beneficiary updated successfully',
        beneficiary: {
          id: row.id,
          userId: row.user_id,
          name: row.name,
          accountNumber: row.account_number,
          routingNumber: row.routing_number,
          bankName: row.bank_name,
          currency: row.currency.trim(),
          status: row.status,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to update beneficiary', statusCode: 500 });
    }
  }
);

beneficiaryRouter.delete(
  '/:id',
  validateRequest(beneficiaryParamsSchema),
  async (req, res: Response) => {
    try {
      const result = await pool.query(
        'DELETE FROM beneficiaries WHERE id = $1 AND ($2::uuid IS NULL OR user_id = $2) RETURNING id',
        [req.params.id, req.user?.role === 'customer' ? req.user.id : null]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Beneficiary not found', statusCode: 404 });
      }
      res.json({ message: 'Beneficiary deleted successfully', id: req.params.id });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to delete beneficiary', statusCode: 500 });
    }
  }
);
