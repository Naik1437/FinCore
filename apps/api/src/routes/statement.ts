import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const statementRouter = Router();

const statementQuerySchema = z.object({
  query: z.object({
    walletId: z.string().uuid('Invalid wallet UUID').optional(),
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    format: z.enum(['json', 'csv']).default('json'),
  }),
});

const walletStatementParamsSchema = z.object({
  params: z.object({
    walletId: z.string().uuid('Invalid wallet UUID'),
  }),
  query: z.object({
    startDate: z.string().optional(),
    endDate: z.string().optional(),
    format: z.enum(['json', 'csv']).default('json'),
  }),
});

async function generateStatement(
  walletIdParam: string | undefined,
  startDateStr: string | undefined,
  endDateStr: string | undefined,
  format: 'json' | 'csv',
  res: Response,
  customerId?: string
) {
  let targetWalletId = walletIdParam;

  if (!targetWalletId) {
    const defaultWallet = await pool.query(
      'SELECT id FROM wallets WHERE status = $1 AND ($2::uuid IS NULL OR user_id = $2) ORDER BY created_at LIMIT 1',
      ['active', customerId ?? null]
    );
    targetWalletId = defaultWallet.rows[0]?.id;
  }

  if (!targetWalletId) {
    return res
      .status(404)
      .json({ error: 'No wallet found to generate statement', statusCode: 404 });
  }

  const walletRes = await pool.query('SELECT * FROM wallets WHERE id = $1', [targetWalletId]);
  if (walletRes.rows.length === 0) {
    return res.status(404).json({ error: 'Wallet not found', statusCode: 404 });
  }
  const wallet = walletRes.rows[0];
  if (customerId && wallet.user_id !== customerId) {
    return res.status(404).json({ error: 'Wallet not found', statusCode: 404 });
  }

  let queryStr = 'SELECT * FROM transactions WHERE wallet_id = $1';
  const params: any[] = [targetWalletId];

  if (startDateStr) {
    params.push(new Date(startDateStr).toISOString());
    queryStr += ` AND created_at >= $${params.length}`;
  }
  if (endDateStr) {
    params.push(new Date(endDateStr).toISOString());
    queryStr += ` AND created_at <= $${params.length}`;
  }

  queryStr += ' ORDER BY created_at DESC';

  const txnsRes = await pool.query(queryStr, params);

  let totalDebits = 0;
  let totalCredits = 0;

  const items = txnsRes.rows.map(row => {
    const amt = parseFloat(row.amount);
    if (row.type === 'deposit') {
      totalCredits += amt;
    } else {
      totalDebits += amt;
    }
    return {
      id: row.id,
      type: row.type,
      amount: amt,
      currency: row.currency.trim(),
      status: row.status,
      description: row.description,
      createdAt: row.created_at,
    };
  });

  const currentBalance = parseFloat(wallet.balance);

  // If CSV requested
  if (format === 'csv') {
    const csvHeader = 'Transaction ID,Date,Type,Amount,Currency,Status,Description\n';
    const csvRows = items
      .map(
        i =>
          `"${i.id}","${i.createdAt}","${i.type}",${i.amount.toFixed(2)},"${i.currency}","${
            i.status
          }","${(i.description || '').replace(/"/g, '""')}"`
      )
      .join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename="statement-${wallet.id.slice(0, 8)}-${Date.now()}.csv"`
    );
    return res.send(csvHeader + csvRows);
  }

  // Default JSON response
  res.json({
    statement: {
      statementId: `STMT-${Date.now().toString(36).toUpperCase()}`,
      generatedAt: new Date().toISOString(),
      period: {
        start: startDateStr || new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
        end: endDateStr || new Date().toISOString(),
      },
      wallet: {
        id: wallet.id,
        userId: wallet.user_id,
        currency: wallet.currency.trim(),
        currentBalance,
        status: wallet.status,
        simulated: true,
      },
      summary: {
        totalDebits: parseFloat(totalDebits.toFixed(4)),
        totalCredits: parseFloat(totalCredits.toFixed(4)),
        netFlow: parseFloat((totalCredits - totalDebits).toFixed(4)),
        transactionCount: items.length,
      },
      transactions: items,
    },
  });
}

statementRouter.get('/', validateRequest(statementQuerySchema), async (req, res: Response) => {
  try {
    const { walletId, startDate, endDate, format = 'json' } = req.query as any;
    await generateStatement(
      walletId,
      startDate,
      endDate,
      format,
      res,
      req.user?.role === 'customer' ? req.user.id : undefined
    );
  } catch (_error) {
    res.status(500).json({ error: 'Failed to generate statement', statusCode: 500 });
  }
});

statementRouter.get(
  '/:walletId',
  validateRequest(walletStatementParamsSchema),
  async (req, res: Response) => {
    try {
      const { walletId } = req.params;
      const { startDate, endDate, format = 'json' } = req.query as any;
      await generateStatement(
        walletId,
        startDate,
        endDate,
        format,
        res,
        req.user?.role === 'customer' ? req.user.id : undefined
      );
    } catch (_error) {
      res.status(500).json({ error: 'Failed to generate statement', statusCode: 500 });
    }
  }
);
