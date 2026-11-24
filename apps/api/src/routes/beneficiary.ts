import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const beneficiaryRouter = Router();

const createBeneficiarySchema = z.object({
  body: z.object({
    name: z.string().min(2, 'Name must be at least 2 characters'),
    accountNumber: z.string().min(4, 'Account number must be at least 4 characters'),
    routingNumber: z.string().optional(),
    bankName: z.string().min(2, 'Bank name is required'),
    currency: z.string().length(3).default('USD'),
  }),
});

const beneficiaryParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

beneficiaryRouter.get('/', async (_req, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM beneficiaries ORDER BY created_at DESC');
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
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch beneficiaries' });
  }
});

beneficiaryRouter.post('/', validateRequest(createBeneficiarySchema), async (req, res: Response) => {
  const { name, accountNumber, routingNumber, bankName, currency } = req.body;
  try {
    const userRes = await pool.query("SELECT id FROM users WHERE email='alex.morgan@example.com' LIMIT 1");
    const userId = userRes.rows[0]?.id;
    if (!userId) {
      return res.status(400).json({ error: 'Default customer user not found' });
    }

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
    res.status(500).json({ error: 'Failed to create beneficiary' });
  }
});

beneficiaryRouter.delete('/:id', validateRequest(beneficiaryParamsSchema), async (req, res: Response) => {
  try {
    const result = await pool.query('DELETE FROM beneficiaries WHERE id = $1 RETURNING id', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Beneficiary not found' });
    }
    res.json({ message: 'Beneficiary deleted successfully', id: req.params.id });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to delete beneficiary' });
  }
});
