import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const disputeRouter = Router();

const createDisputeSchema = z.object({
  body: z.object({
    transactionId: z.string().uuid(),
    reason: z.string().min(3, 'Reason must be at least 3 characters'),
    details: z.string().min(5, 'Details must be at least 5 characters'),
  }),
});

const updateDisputeSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
  body: z.object({
    status: z.enum(['pending_review', 'under_investigation', 'resolved', 'rejected']),
    resolutionNotes: z.string().optional(),
  }),
});

disputeRouter.get('/', async (_req, res: Response) => {
  try {
    const result = await pool.query(`
      SELECT d.*, t.amount, t.currency, t.type as transaction_type, t.description as transaction_description
      FROM disputes d
      JOIN transactions t ON d.transaction_id = t.id
      ORDER BY d.created_at DESC
    `);
    res.json({
      disputes: result.rows.map(row => ({
        id: row.id,
        transactionId: row.transaction_id,
        userId: row.user_id,
        reason: row.reason,
        details: row.details,
        status: row.status,
        resolutionNotes: row.resolution_notes,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        transaction: {
          amount: parseFloat(row.amount),
          currency: row.currency.trim(),
          type: row.transaction_type,
          description: row.transaction_description,
        },
      })),
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch disputes' });
  }
});

disputeRouter.post('/', validateRequest(createDisputeSchema), async (req, res: Response) => {
  const { transactionId, reason, details } = req.body;
  try {
    // Check transaction exists
    const txnRes = await pool.query('SELECT * FROM transactions WHERE id = $1', [transactionId]);
    if (txnRes.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found' });
    }

    // Check if already disputed
    const existing = await pool.query('SELECT id FROM disputes WHERE transaction_id = $1', [transactionId]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ error: 'A dispute has already been submitted for this transaction' });
    }

    // User
    const userRes = await pool.query("SELECT id FROM users WHERE email='alex.morgan@example.com' LIMIT 1");
    const userId = userRes.rows[0]?.id;

    const result = await pool.query(
      `INSERT INTO disputes (transaction_id, user_id, reason, details, status)
       VALUES ($1, $2, $3, $4, 'pending_review')
       RETURNING *`,
      [transactionId, userId, reason, details]
    );

    const row = result.rows[0];
    res.status(201).json({
      message: 'Dispute submitted successfully',
      dispute: {
        id: row.id,
        transactionId: row.transaction_id,
        reason: row.reason,
        details: row.details,
        status: row.status,
        createdAt: row.created_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to submit dispute' });
  }
});

disputeRouter.patch('/:id', validateRequest(updateDisputeSchema), async (req, res: Response) => {
  const { status, resolutionNotes } = req.body;
  try {
    const result = await pool.query(
      `UPDATE disputes
       SET status = $1, resolution_notes = $2, updated_at = NOW()
       WHERE id = $3
       RETURNING *`,
      [status, resolutionNotes || null, req.params.id]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dispute not found' });
    }

    res.json({
      message: 'Dispute status updated',
      dispute: result.rows[0],
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to update dispute' });
  }
});
