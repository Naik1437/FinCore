import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const settlementRouter = Router();

const createSettlementSchema = z.object({
  body: z.object({
    transactionId: z.string().uuid('Invalid transaction UUID format'),
    sourceWalletId: z.string().uuid('Invalid source wallet UUID format'),
    destinationWalletId: z.string().uuid('Invalid destination wallet UUID format'),
    amount: z.number().positive('Settlement amount must be greater than 0'),
    currency: z.string().length(3).default('USD'),
    clearingInstitution: z.string().optional(),
    referenceId: z.string().optional(),
  }),
});

const settlementParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid settlement UUID format'),
  }),
});

const listSettlementsSchema = z.object({
  query: z.object({
    status: z.enum(['pending', 'cleared', 'settled', 'failed']).optional(),
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(50),
  }),
});

settlementRouter.post('/', validateRequest(createSettlementSchema), async (req, res: Response) => {
  // Authorization check: settlements require finance_administrator or platform_administrator
  if (req.user && req.user.role === 'customer') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Settlement execution is restricted to finance and platform administrators',
      statusCode: 403,
    });
  }

  const {
    transactionId,
    sourceWalletId,
    destinationWalletId,
    amount,
    currency,
    clearingInstitution,
    referenceId,
  } = req.body;

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const txnRes = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [
      transactionId,
    ]);
    if (txnRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaction not found', statusCode: 404 });
    }

    const posting = await client.query(
      `SELECT 1 FROM transactions t
       WHERE id = $1 AND status = 'completed' AND wallet_id = $2 AND amount = $4::numeric
         AND currency = $5 AND $2::uuid <> $3::uuid
         AND EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = t.id AND wallet_id = $2 AND entry_type = 'debit' AND amount = t.amount AND currency = t.currency)
         AND EXISTS (SELECT 1 FROM ledger_entries WHERE transaction_id = t.id AND wallet_id = $3 AND entry_type = 'credit' AND amount = t.amount AND currency = t.currency)
         AND NOT EXISTS (SELECT 1 FROM settlements WHERE transaction_id = t.id)`,
      [transactionId, sourceWalletId, destinationWalletId, amount, currency.toUpperCase()]
    );
    if (!posting.rowCount) {
      await client.query('ROLLBACK');
      return res
        .status(409)
        .json({ error: 'Settlement does not match an unsettled completed posting' });
    }

    const institution = clearingInstitution || 'FinCore Automated Clearing House';
    const refId = referenceId || `CLR-${Date.now().toString(36).toUpperCase()}`;

    const result = await client.query(
      `INSERT INTO settlements (transaction_id, source_wallet_id, destination_wallet_id, amount, currency, status, clearing_institution, reference_id, settled_at)
       VALUES ($1, $2, $3, $4::numeric(18, 4), $5, 'settled', $6, $7, NOW())
       RETURNING *`,
      [
        transactionId,
        sourceWalletId,
        destinationWalletId,
        amount,
        currency.toUpperCase(),
        institution,
        refId,
      ]
    );
    const row = result.rows[0];

    // Audit log
    await client.query(
      `INSERT INTO financial_audit_logs (entity_type, entity_id, action, actor_id, details)
       VALUES ('settlement', $1, 'SETTLEMENT_RECORDED', $2, $3)`,
      [
        row.id,
        req.user?.id || 'system',
        JSON.stringify({
          transactionId,
          sourceWalletId,
          destinationWalletId,
          amount,
          clearingInstitution: institution,
          referenceId: refId,
        }),
      ]
    );

    await client.query('COMMIT');
    res.status(201).json({
      message: 'Settlement recorded successfully',
      settlement: {
        id: row.id,
        transactionId: row.transaction_id,
        sourceWalletId: row.source_wallet_id,
        destinationWalletId: row.destination_wallet_id,
        amount: parseFloat(row.amount),
        currency: row.currency.trim(),
        status: row.status,
        clearingInstitution: row.clearing_institution,
        referenceId: row.reference_id,
        settledAt: row.settled_at,
        createdAt: row.created_at,
      },
    });
  } catch (_error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to record settlement', statusCode: 500 });
  } finally {
    client.release();
  }
});

settlementRouter.get('/', validateRequest(listSettlementsSchema), async (req, res: Response) => {
  try {
    const { status, page = 1, limit = 50 } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    let countQuery = 'SELECT COUNT(*) as count FROM settlements WHERE 1=1';
    let dataQuery = 'SELECT * FROM settlements WHERE 1=1';
    const params: any[] = [];

    if (status) {
      params.push(status);
      const clause = ` AND status = $${params.length}`;
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
      settlements: result.rows.map(row => ({
        id: row.id,
        transactionId: row.transaction_id,
        sourceWalletId: row.source_wallet_id,
        destinationWalletId: row.destination_wallet_id,
        amount: parseFloat(row.amount),
        currency: row.currency.trim(),
        status: row.status,
        clearingInstitution: row.clearing_institution,
        referenceId: row.reference_id,
        settledAt: row.settled_at,
        createdAt: row.created_at,
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)) || 1,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch settlements', statusCode: 500 });
  }
});

settlementRouter.get(
  '/:id',
  validateRequest(settlementParamsSchema),
  async (req, res: Response) => {
    try {
      const { id } = req.params;
      const result = await pool.query('SELECT * FROM settlements WHERE id = $1', [id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Settlement record not found', statusCode: 404 });
      }
      const row = result.rows[0];
      res.json({
        settlement: {
          id: row.id,
          transactionId: row.transaction_id,
          sourceWalletId: row.source_wallet_id,
          destinationWalletId: row.destination_wallet_id,
          amount: parseFloat(row.amount),
          currency: row.currency.trim(),
          status: row.status,
          clearingInstitution: row.clearing_institution,
          referenceId: row.reference_id,
          settledAt: row.settled_at,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch settlement', statusCode: 500 });
    }
  }
);
