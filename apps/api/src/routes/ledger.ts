import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const ledgerRouter = Router();

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

ledgerRouter.post('/', (_req, res) => {
  res.status(405).json({ error: 'Ledger postings must use a financial operation' });
});

ledgerRouter.get('/reconciliation', async (_req, res: Response) => {
  try {
    const summaryRes = await pool.query(`
      SELECT 
        COALESCE(SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END), 0) as total_debits,
        COALESCE(SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END), 0) as total_credits,
        COUNT(*) as total_entries
      FROM ledger_entries
    `);

    const unbalancedTxnsRes = await pool.query(`
      SELECT transaction_id, 
             COUNT(*) as entry_count, 
             SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debit,
             SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credit
      FROM ledger_entries
      GROUP BY transaction_id
      HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END)
    `);

    const totalDebits = parseFloat(summaryRes.rows[0].total_debits);
    const totalCredits = parseFloat(summaryRes.rows[0].total_credits);
    const difference = parseFloat((totalDebits - totalCredits).toFixed(4));
    const unbalancedCount = unbalancedTxnsRes.rows.length;
    const isBalanced = difference === 0 && unbalancedCount === 0;

    res.json({
      reconciliation: {
        balanced: isBalanced,
        totalDebits,
        totalCredits,
        difference,
        totalLedgerEntries: parseInt(summaryRes.rows[0].total_entries, 10),
        unbalancedTransactionsCount: unbalancedCount,
        unbalancedTransactions: unbalancedTxnsRes.rows,
        verifiedAt: new Date().toISOString(),
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to perform ledger reconciliation', statusCode: 500 });
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
    const result = await pool.query(
      'SELECT id, balance, currency, updated_at FROM wallets WHERE id = $1',
      [req.params.walletId]
    );
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
