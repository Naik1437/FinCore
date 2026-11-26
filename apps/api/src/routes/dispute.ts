import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const disputeRouter = Router();

const createDisputeSchema = z.object({
  body: z.object({
    transactionId: z.string().uuid('Invalid transaction UUID format'),
    reason: z.string().min(3, 'Reason must be at least 3 characters'),
    details: z.string().min(5, 'Details must be at least 5 characters'),
  }),
});

const updateDisputeSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid dispute UUID format'),
  }),
  body: z.object({
    status: z.enum(['pending_review', 'under_investigation', 'resolved', 'rejected']),
    resolutionNotes: z.string().optional(),
  }),
});

const disputeParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid dispute UUID format'),
  }),
});

const listDisputesSchema = z.object({
  query: z.object({
    status: z.enum(['pending_review', 'under_investigation', 'resolved', 'rejected']).optional(),
    transactionId: z.string().uuid().optional(),
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(50),
  }),
});

disputeRouter.get('/', validateRequest(listDisputesSchema), async (req, res: Response) => {
  try {
    const { status, transactionId, page = 1, limit = 50 } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    let countQuery = 'SELECT COUNT(*) as count FROM disputes d WHERE 1=1';
    let dataQuery = `
      SELECT d.*, t.amount, t.currency, t.type as transaction_type, t.description as transaction_description
      FROM disputes d
      JOIN transactions t ON d.transaction_id = t.id
      WHERE 1=1
    `;
    const params: any[] = [];

    if (req.user?.role === 'customer') {
      params.push(req.user.id);
      countQuery += ' AND d.user_id = $1';
      dataQuery += ' AND d.user_id = $1';
    }
    if (status) {
      params.push(status);
      const clause = ` AND d.status = $${params.length}`;
      countQuery += clause;
      dataQuery += clause;
    }
    if (transactionId) {
      params.push(transactionId);
      const clause = ` AND d.transaction_id = $${params.length}`;
      countQuery += clause;
      dataQuery += clause;
    }

    const countRes = await pool.query(countQuery, params);
    const total = parseInt(countRes.rows[0]?.count || '0', 10);

    params.push(Number(limit));
    dataQuery += ` ORDER BY d.created_at DESC LIMIT $${params.length}`;
    params.push(offset);
    dataQuery += ` OFFSET $${params.length}`;

    const result = await pool.query(dataQuery, params);

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
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)) || 1,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch disputes', statusCode: 500 });
  }
});

disputeRouter.get('/:id', validateRequest(disputeParamsSchema), async (req, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      `SELECT d.*, t.amount, t.currency, t.type as transaction_type, t.description as transaction_description, t.wallet_id
       FROM disputes d
       JOIN transactions t ON d.transaction_id = t.id
       WHERE d.id = $1 AND ($2::uuid IS NULL OR d.user_id = $2)`,
      [id, req.user?.role === 'customer' ? req.user.id : null]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Dispute not found', statusCode: 404 });
    }

    const row = result.rows[0];

    // Fetch related ledger entries for transparency
    const ledgerRes = await pool.query(
      'SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY created_at ASC',
      [row.transaction_id]
    );

    res.json({
      dispute: {
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
          id: row.transaction_id,
          walletId: row.wallet_id,
          amount: parseFloat(row.amount),
          currency: row.currency.trim(),
          type: row.transaction_type,
          description: row.transaction_description,
        },
        ledgerEntries: ledgerRes.rows.map(l => ({
          id: l.id,
          walletId: l.wallet_id,
          entryType: l.entry_type,
          amount: parseFloat(l.amount),
          currency: l.currency.trim(),
          balanceAfter: parseFloat(l.balance_after),
          createdAt: l.created_at,
        })),
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch dispute', statusCode: 500 });
  }
});

disputeRouter.post('/', validateRequest(createDisputeSchema), async (req, res: Response) => {
  const { transactionId, reason, details } = req.body;
  try {
    // Check transaction exists
    const txnRes = await pool.query(
      'SELECT w.user_id FROM transactions t JOIN wallets w ON w.id = t.wallet_id WHERE t.id = $1 AND ($2::uuid IS NULL OR w.user_id = $2)',
      [transactionId, req.user?.role === 'customer' ? req.user.id : null]
    );
    if (txnRes.rows.length === 0) {
      return res.status(404).json({ error: 'Transaction not found', statusCode: 404 });
    }

    // Check if already disputed
    const existing = await pool.query('SELECT id FROM disputes WHERE transaction_id = $1', [
      transactionId,
    ]);
    if (existing.rows.length > 0) {
      return res.status(400).json({
        error: 'A dispute has already been submitted for this transaction',
        statusCode: 400,
      });
    }

    const userId = txnRes.rows[0].user_id;

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
    res.status(500).json({ error: 'Failed to submit dispute', statusCode: 500 });
  }
});

disputeRouter.patch('/:id', validateRequest(updateDisputeSchema), async (req, res: Response) => {
  // Authorization check: only support, operations, or platform admin can adjudicate disputes
  if (req.user && req.user.role === 'customer') {
    return res.status(403).json({
      error: 'Forbidden',
      message:
        'Customers cannot adjudicate disputes. Adjudication requires support or operations role.',
      statusCode: 403,
    });
  }

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
      return res.status(404).json({ error: 'Dispute not found', statusCode: 404 });
    }

    res.json({
      message: 'Dispute status updated',
      dispute: result.rows[0],
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to update dispute', statusCode: 500 });
  }
});
