import type { Response } from 'express';
import { Router } from 'express';
import { pool } from '../services/database.js';

export const reportRouter = Router();

reportRouter.get('/statement', async (req, res: Response) => {
  try {
    const { walletId } = req.query as { walletId?: string };

    const customerId = req.user?.role === 'customer' ? req.user.id : null;
    // Default to the first active wallet visible to the caller.
    let targetWalletId = walletId;
    if (!targetWalletId) {
      const wRes = await pool.query(
        'SELECT id FROM wallets WHERE status = $1 AND ($2::uuid IS NULL OR user_id = $2) ORDER BY created_at LIMIT 1',
        ['active', customerId]
      );
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
    if (customerId && wallet.user_id !== customerId) {
      return res.status(404).json({ error: 'Wallet not found' });
    }

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
    const walletsCount = await pool.query(
      'SELECT COUNT(*) as count FROM wallets WHERE status = $1',
      ['active']
    );
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

const ANALYTICS_SERVICE_URL = process.env.ANALYTICS_SERVICE_URL || 'http://127.0.0.1:8000';

reportRouter.get('/risk', async (_req, res: Response) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);
    const response = await fetch(`${ANALYTICS_SERVICE_URL}/api/v1/risk/summary`, {
      headers: { 'x-analytics-token': process.env.ANALYTICS_SERVICE_TOKEN || '' },
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
  } catch (_e) {
    // Analytics service offline or unreachable, fall back to DB metrics
  }

  try {
    const txCount = await pool.query('SELECT COUNT(*) as count FROM transactions');
    const disputeCount = await pool.query('SELECT COUNT(*) as count FROM disputes');
    const total = parseInt(txCount.rows[0]?.count || '0', 10);
    const disputes = parseInt(disputeCount.rows[0]?.count || '0', 10);

    return res.json({
      total_evaluated: total,
      tier_counts: {
        LOW: Math.max(0, total - disputes),
        MEDIUM: 0,
        HIGH: disputes,
        CRITICAL: 0,
      },
      critical_alerts: 0,
      active_rules: 6,
      disclaimer:
        'Risk scores represent automated statistical decision support and algorithmic heuristics, not definitive legal proof of fraud or illicit activity.',
    });
  } catch (_err) {
    return res.status(500).json({ error: 'Failed to retrieve risk summary' });
  }
});

reportRouter.post('/risk/evaluate', async (req, res: Response) => {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 3000);
    const response = await fetch(`${ANALYTICS_SERVICE_URL}/api/v1/risk/evaluate`, {
      method: 'POST',
      headers: {
        'x-analytics-token': process.env.ANALYTICS_SERVICE_TOKEN || '',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(req.body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (response.ok) {
      const data = await response.json();
      return res.json(data);
    }
    const errData = await response.json().catch(() => ({}));
    return res.status(response.status).json(errData);
  } catch (_e) {
    // In-process fallback rule evaluation
    const amount = Number(req.body?.amount || 0);
    const score = amount > 10000 ? 75 : amount > 5000 ? 45 : 15;
    const tier = score >= 90 ? 'CRITICAL' : score >= 70 ? 'HIGH' : score >= 30 ? 'MEDIUM' : 'LOW';
    return res.json({
      transaction_id: req.body?.transaction_id || `TX-${Date.now()}`,
      risk_score: score,
      risk_tier: tier,
      recommended_action:
        score >= 90
          ? 'REJECT'
          : score >= 70
            ? 'MANUAL_REVIEW'
            : score >= 30
              ? 'STEP_UP_AUTH'
              : 'APPROVE',
      factors: [
        {
          rule_id: 'RULE_FALLBACK',
          factor_name: 'Amount Threshold Check',
          score_contribution: score,
          description: `Transaction amount of ${amount} evaluated via local fallback heuristics`,
          raw_metric: amount,
        },
      ],
      disclaimer:
        'Risk scores represent automated statistical decision support and algorithmic heuristics, not definitive legal proof of fraud or illicit activity.',
    });
  }
});
