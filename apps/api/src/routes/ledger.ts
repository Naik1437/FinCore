import { Response, Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const ledgerRouter = Router();

const ledgerEntrySchema = z.object({
  body: z.object({
    walletId: z.string().uuid(),
    transactionId: z.string().uuid(),
    entryType: z.enum(['debit', 'credit']),
    amount: z.number().positive(),
    currency: z.string().length(3).default('USD'),
    description: z.string().optional(),
  }),
});

const ledgerParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

const listLedgerSchema = z.object({
  query: z.object({
    walletId: z.string().uuid().optional(),
    entryType: z.enum(['debit', 'credit']).optional(),
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(50),
  }),
});

ledgerRouter.post('/', validateRequest(ledgerEntrySchema), async (req, res: Response) => {
  const { walletId, transactionId, entryType, amount, currency, description } = req.body;
  try {
    const walletRes = await pool.query('SELECT balance FROM wallets WHERE id = $1', [walletId]);
    const balanceAfter = walletRes.rows[0] ? parseFloat(walletRes.rows[0].balance) : amount;
    
    const result = await pool.query(
      `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING *`,
      [walletId, transactionId, entryType, amount, currency.toUpperCase(), balanceAfter, description || null]
    );
    const row = result.rows[0];
    res.status(201).json({
      message: 'Ledger entry created',
      entry: {
        id: row.id,
        walletId: row.wallet_id,
        transactionId: row.transaction_id,
        entryType: row.entry_type,
        amount: parseFloat(row.amount),
        currency: row.currency.trim(),
        balanceAfter: parseFloat(row.balance_after),
        description: row.description,
        createdAt: row.created_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to create ledger entry' });
  }
});

ledgerRouter.get('/:id', validateRequest(ledgerParamsSchema), async (req, res: Response) => {
  try {
    const result = await pool.query('SELECT * FROM ledger_entries WHERE id = $1', [req.params.id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Ledger entry not found' });
    }
    const row = result.rows[0];
    res.json({
      entry: {
        id: row.id,
        walletId: row.wallet_id,
        transactionId: row.transaction_id,
        entryType: row.entry_type,
        amount: parseFloat(row.amount),
        currency: row.currency.trim(),
        balanceAfter: parseFloat(row.balance_after),
        description: row.description,
        createdAt: row.created_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch ledger entry' });
  }
});

ledgerRouter.get('/', validateRequest(listLedgerSchema), async (req, res: Response) => {
  try {
    const { walletId, entryType, page = 1, limit = 50 } = req.query as any;
    let queryStr = 'SELECT * FROM ledger_entries WHERE 1=1';
    const params: any[] = [];

    if (walletId) {
      params.push(walletId);
      queryStr += ` AND wallet_id = $${params.length}`;
    }
    if (entryType) {
      params.push(entryType);
      queryStr += ` AND entry_type = $${params.length}`;
    }

    queryStr += ' ORDER BY created_at DESC';

    const result = await pool.query(queryStr, params);
    res.json({
      entries: result.rows.map(row => ({
        id: row.id,
        walletId: row.wallet_id,
        transactionId: row.transaction_id,
        entryType: row.entry_type,
        amount: parseFloat(row.amount),
        currency: row.currency.trim(),
        balanceAfter: parseFloat(row.balance_after),
        description: row.description,
        createdAt: row.created_at,
      })),
      pagination: { page: Number(page), limit: Number(limit), total: result.rowCount },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch ledger entries' });
  }
});

ledgerRouter.get('/wallet/:walletId/balance', async (req, res: Response) => {
  try {
    const result = await pool.query('SELECT id, balance, currency, updated_at FROM wallets WHERE id = $1', [
      req.params.walletId,
    ]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    const row = result.rows[0];
    res.json({
      walletId: row.id,
      balance: parseFloat(row.balance),
      currency: row.currency.trim(),
      simulated: true,
      lastUpdated: row.updated_at,
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch wallet balance' });
  }
});
