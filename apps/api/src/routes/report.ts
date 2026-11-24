import type { Response } from 'express';
import { Router } from 'express';
import { pool } from '../services/database.js';

export const reportRouter = Router();

reportRouter.get('/statement', async (req, res: Response) => {
  try {
    const { walletId } = req.query as { walletId?: string };
    
    // Default to first active wallet if not specified
    let targetWalletId = walletId;
    if (!targetWalletId) {
      const wRes = await pool.query('SELECT id FROM wallets WHERE status = $1 LIMIT 1', ['active']);
      targetWalletId = wRes.rows[0]?.id;
    }

    if (!targetWalletId) {
      return res.status(404).json({ error: 'No wallet found for statement' });
    }

    const walletRes = await pool.query('SELECT * FROM wallets WHERE id = $1', [targetWalletId]);
    if (walletRes.rows.length === 0) {
      return res.status(404).json({ error: 'Wallet not found' });
    }
    const wallet = walletRes.rows[0];

    const txnsRes = await pool.query(
      'SELECT * FROM transactions WHERE wallet_id = $1 ORDER BY created_at DESC',
      [targetWalletId]
    );

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

    res.json({
      statement: {
        statementId: `STMT-${Date.now().toString(36).toUpperCase()}`,
        generatedAt: new Date().toISOString(),
        period: {
          start: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString(),
          end: new Date().toISOString(),
        },
        wallet: {
          id: wallet.id,
          currency: wallet.currency.trim(),
          currentBalance,
          simulated: true,
        },
        summary: {
          totalDebits,
          totalCredits,
          netFlow: totalCredits - totalDebits,
          transactionCount: items.length,
        },
        transactions: items,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to generate financial statement' });
  }
});

reportRouter.get('/summary', async (_req, res: Response) => {
  try {
    const walletsCount = await pool.query('SELECT COUNT(*) as count FROM wallets WHERE status = $1', ['active']);
    const txnsStats = await pool.query(`
      SELECT 
        COUNT(*) as total_count,
        COALESCE(SUM(amount), 0) as total_volume,
        COUNT(*) FILTER (WHERE status = 'pending') as pending_count,
        COUNT(*) FILTER (WHERE status = 'failed') as failed_count
      FROM transactions
    `);
    const disputesStats = await pool.query(`
      SELECT 
        COUNT(*) as total_disputes,
        COUNT(*) FILTER (WHERE status = 'pending_review' OR status = 'under_investigation') as open_disputes
      FROM disputes
    `);
    const ledgerStats = await pool.query('SELECT COUNT(*) as total_entries FROM ledger_entries');

    res.json({
      activeWallets: parseInt(walletsCount.rows[0].count, 10),
      totalTransactions: parseInt(txnsStats.rows[0].total_count, 10),
      totalVolume: parseFloat(txnsStats.rows[0].total_volume),
      pendingTransactions: parseInt(txnsStats.rows[0].pending_count, 10),
      failedTransactions: parseInt(txnsStats.rows[0].failed_count, 10),
      totalDisputes: parseInt(disputesStats.rows[0].total_disputes, 10),
      openDisputes: parseInt(disputesStats.rows[0].open_disputes, 10),
      immutableLedgerEntries: parseInt(ledgerStats.rows[0].total_entries, 10),
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to generate operations summary' });
  }
});
