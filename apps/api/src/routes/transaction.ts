import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const transactionRouter = Router();

const createTransactionSchema = z.object({
  body: z.object({
    walletId: z.string().uuid(),
    type: z.enum(['deposit', 'withdrawal', 'transfer', 'payment']),
    amount: z.number().positive(),
    currency: z.string().length(3).default('USD'),
    description: z.string().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

const transferSchema = z.object({
  body: z.object({
    sourceWalletId: z.string().uuid(),
    beneficiaryId: z.string().uuid(),
    amount: z.number().positive('Transfer amount must be strictly greater than 0'),
    description: z.string().min(1, 'Description is required'),
    idempotencyKey: z.string().optional(),
  }),
});

const transactionParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid(),
  }),
});

const listTransactionsSchema = z.object({
  query: z.object({
    walletId: z.string().uuid().optional(),
    type: z.enum(['deposit', 'withdrawal', 'transfer', 'payment']).optional(),
    status: z.enum(['pending', 'processing', 'completed', 'failed', 'cancelled']).optional(),
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(50),
  }),
});

// Helper for precise monetary arithmetic (4 decimal places)
function toFixedUnits(val: number | string): bigint {
  const str = typeof val === 'number' ? val.toFixed(4) : String(val).trim();
  const [intPart = '0', fracPart = ''] = str.split('.');
  const paddedFrac = fracPart.padEnd(4, '0').slice(0, 4);
  const sign = intPart.startsWith('-') ? -1n : 1n;
  const absInt = intPart.replace('-', '');
  return sign * (BigInt(absInt || '0') * 10000n + BigInt(paddedFrac || '0'));
}

function formatFromUnits(units: bigint): string {
  const isNegative = units < 0n;
  const absUnits = isNegative ? -units : units;
  const intPart = absUnits / 10000n;
  const fracPart = (absUnits % 10000n).toString().padStart(4, '0');
  return `${isNegative ? '-' : ''}${intPart}.${fracPart}`;
}

// Helper to get or create same-currency settlement wallet atomically
async function getOrCreateSettlementWallet(
  client: any,
  currency: string
): Promise<{ id: string; balance: string }> {
  let userRes = await client.query(
    "SELECT id FROM users WHERE email = 'settlement@fincore.internal'"
  );
  let settlementUserId: string;
  if (userRes.rows.length === 0) {
    const newUserRes = await client.query(
      `INSERT INTO users (email, full_name, is_verified)
       VALUES ('settlement@fincore.internal', 'FinCore Settlement Treasury', true)
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`
    );
    settlementUserId = newUserRes.rows[0].id;
  } else {
    settlementUserId = userRes.rows[0].id;
  }

  let walletRes = await client.query(
    'SELECT id, balance FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE',
    [settlementUserId, currency]
  );
  if (walletRes.rows.length === 0) {
    const newWalletRes = await client.query(
      `INSERT INTO wallets (user_id, currency, balance, status)
       VALUES ($1, $2, 0.0000, 'active')
       RETURNING id, balance`,
      [settlementUserId, currency]
    );
    return {
      id: newWalletRes.rows[0].id,
      balance: newWalletRes.rows[0].balance,
    };
  }

  return {
    id: walletRes.rows[0].id,
    balance: walletRes.rows[0].balance,
  };
}

// Transfer endpoint with business validation & atomic double-entry ledger update
transactionRouter.post(
  '/transfer',
  validateRequest(transferSchema),
  async (req, res: Response) => {
    const { sourceWalletId, beneficiaryId, amount, description, idempotencyKey } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Precise monetary parsing of requested transfer amount
      const requestedUnits = toFixedUnits(amount);
      if (requestedUnits <= 0n) {
        await client.query('ROLLBACK');
        return res.status(400).json({ error: 'Transfer amount must be strictly greater than 0' });
      }
      const formattedAmount = formatFromUnits(requestedUnits);

      // 2. Duplicate transfer protection: Idempotency Key check
      if (idempotencyKey) {
        const existingTxnRes = await client.query(
          'SELECT * FROM transactions WHERE idempotency_key = $1',
          [idempotencyKey]
        );
        if (existingTxnRes.rows.length > 0) {
          await client.query('ROLLBACK');
          const existing = existingTxnRes.rows[0];
          const currentWalletRes = await pool.query('SELECT balance FROM wallets WHERE id = $1', [
            sourceWalletId,
          ]);
          return res.status(200).json({
            message: 'Transfer already processed (idempotent duplicate submission)',
            transaction: {
              id: existing.id,
              walletId: existing.wallet_id,
              type: existing.type,
              amount: parseFloat(existing.amount),
              currency: existing.currency.trim(),
              status: existing.status,
              description: existing.description,
              createdAt: existing.created_at,
            },
            duplicate: true,
            newBalance: currentWalletRes.rows[0] ? parseFloat(currentWalletRes.rows[0].balance) : 0,
          });
        }
      }

      // 3. Verify source wallet and acquire row-level exclusive lock
      const walletRes = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [
        sourceWalletId,
      ]);
      if (walletRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Source wallet not found' });
      }

      const wallet = walletRes.rows[0];
      if (wallet.status !== 'active') {
        await client.query('ROLLBACK');
        return res
          .status(400)
          .json({ error: `Wallet is currently ${wallet.status} and cannot process transfers` });
      }

      const sourceUnits = toFixedUnits(wallet.balance);
      if (sourceUnits < requestedUnits) {
        await client.query('ROLLBACK');
        const availableFormatted = formatFromUnits(sourceUnits);
        return res.status(400).json({
          error: `Insufficient simulated funds. Available: ${availableFormatted} ${wallet.currency.trim()}, Requested: ${formattedAmount} ${wallet.currency.trim()}`,
        });
      }

      // 4. Verify beneficiary
      const benRes = await client.query('SELECT * FROM beneficiaries WHERE id = $1', [
        beneficiaryId,
      ]);
      if (benRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Beneficiary not found' });
      }
      const beneficiary = benRes.rows[0];

      // 5. Currency match check
      const walletCurrency = wallet.currency.trim();
      const benCurrency = beneficiary.currency.trim();
      if (walletCurrency !== benCurrency) {
        await client.query('ROLLBACK');
        return res.status(400).json({
          error: `Currency mismatch: source wallet is ${walletCurrency} but beneficiary account is ${benCurrency}`,
        });
      }

      const fullDesc = `Transfer to ${beneficiary.name} (${beneficiary.bank_name}): ${description}`;

      // 6. Secondary duplicate check (recent identical transfer without idempotency key within 5 seconds)
      if (!idempotencyKey) {
        const recentDupRes = await client.query(
          `SELECT * FROM transactions 
           WHERE wallet_id = $1 
             AND type = 'transfer' 
             AND amount = $2::numeric(18, 4) 
             AND description = $3 
             AND created_at >= NOW() - INTERVAL '5 seconds'`,
          [sourceWalletId, formattedAmount, fullDesc]
        );
        if (recentDupRes.rows.length > 0) {
          await client.query('ROLLBACK');
          const existing = recentDupRes.rows[0];
          return res.status(200).json({
            message: 'Duplicate transfer detected within 5-second window',
            transaction: {
              id: existing.id,
              walletId: existing.wallet_id,
              type: existing.type,
              amount: parseFloat(existing.amount),
              currency: existing.currency.trim(),
              status: existing.status,
              description: existing.description,
              createdAt: existing.created_at,
            },
            duplicate: true,
            newBalance: parseFloat(wallet.balance),
          });
        }
      }

      // 7. Get or create appropriate same-currency settlement account
      const settlementWallet = await getOrCreateSettlementWallet(client, walletCurrency);

      // 8. Update source wallet balance using exact numeric arithmetic
      const sourceUpdateRes = await client.query(
        `UPDATE wallets 
         SET balance = balance - $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING balance`,
        [formattedAmount, sourceWalletId]
      );
      const newSourceBalance = sourceUpdateRes.rows[0].balance;

      // 9. Update settlement wallet balance using exact numeric arithmetic
      const settlementUpdateRes = await client.query(
        `UPDATE wallets 
         SET balance = balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING balance`,
        [formattedAmount, settlementWallet.id]
      );
      const newSettlementBalance = settlementUpdateRes.rows[0].balance;

      // 10. Insert transaction record
      const txnRes = await client.query(
        `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata, idempotency_key)
         VALUES ($1, 'transfer', $2::numeric(18, 4), $3, 'completed', $4, $5, $6)
         RETURNING *`,
        [
          sourceWalletId,
          formattedAmount,
          walletCurrency,
          fullDesc,
          JSON.stringify({
            beneficiaryId,
            beneficiaryName: beneficiary.name,
            accountNumber: beneficiary.account_number,
            settlementWalletId: settlementWallet.id,
          }),
          idempotencyKey || null,
        ]
      );
      const txn = txnRes.rows[0];

      // 11. Insert matching DEBIT ledger entry for source wallet
      await client.query(
        `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
         VALUES ($1, $2, 'debit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
        [
          sourceWalletId,
          txn.id,
          formattedAmount,
          walletCurrency,
          newSourceBalance,
          `Simulated transfer debit to ${beneficiary.name}`,
        ]
      );

      // 12. Insert matching CREDIT ledger entry for same-currency settlement account
      await client.query(
        `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
         VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
        [
          settlementWallet.id,
          txn.id,
          formattedAmount,
          walletCurrency,
          newSettlementBalance,
          `Transfer settlement credit from wallet ${sourceWalletId.slice(0, 8)} for ${beneficiary.name}`,
        ]
      );

      // 13. Atomic commit
      await client.query('COMMIT');

      res.status(201).json({
        message: 'Transfer completed successfully',
        transaction: {
          id: txn.id,
          walletId: txn.wallet_id,
          type: txn.type,
          amount: parseFloat(txn.amount),
          currency: txn.currency.trim(),
          status: txn.status,
          description: txn.description,
          createdAt: txn.created_at,
        },
        newBalance: parseFloat(newSourceBalance),
      });
    } catch (error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Transfer processing failed' });
    } finally {
      client.release();
    }
  }
);

transactionRouter.post(
  '/',
  validateRequest(createTransactionSchema),
  async (req, res: Response) => {
    const { walletId, type, amount, currency, description, metadata } = req.body;
    try {
      const result = await pool.query(
        `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6)
         RETURNING *`,
        [walletId, type, amount, currency.toUpperCase(), description || null, JSON.stringify(metadata || {})]
      );
      const row = result.rows[0];
      res.status(201).json({
        message: 'Transaction created',
        transaction: {
          id: row.id,
          walletId: row.wallet_id,
          type: row.type,
          amount: parseFloat(row.amount),
          currency: row.currency.trim(),
          status: row.status,
          description: row.description,
          createdAt: row.created_at,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to create transaction' });
    }
  }
);

transactionRouter.get(
  '/:id',
  validateRequest(transactionParamsSchema),
  async (req, res: Response) => {
    try {
      const result = await pool.query('SELECT * FROM transactions WHERE id = $1', [req.params.id]);
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Transaction not found' });
      }
      const row = result.rows[0];
      res.json({
        transaction: {
          id: row.id,
          walletId: row.wallet_id,
          type: row.type,
          amount: parseFloat(row.amount),
          currency: row.currency.trim(),
          status: row.status,
          description: row.description,
          metadata: row.metadata,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch transaction' });
    }
  }
);

transactionRouter.get('/', validateRequest(listTransactionsSchema), async (req, res: Response) => {
  try {
    const { walletId, type, status, page = 1, limit = 50 } = req.query as any;
    let queryStr = 'SELECT * FROM transactions WHERE 1=1';
    const params: any[] = [];

    if (walletId) {
      params.push(walletId);
      queryStr += ` AND wallet_id = $${params.length}`;
    }
    if (type) {
      params.push(type);
      queryStr += ` AND type = $${params.length}`;
    }
    if (status) {
      params.push(status);
      queryStr += ` AND status = $${params.length}`;
    }

    queryStr += ' ORDER BY created_at DESC';

    const result = await pool.query(queryStr, params);
    res.json({
      transactions: result.rows.map(row => ({
        id: row.id,
        walletId: row.wallet_id,
        type: row.type,
        amount: parseFloat(row.amount),
        currency: row.currency.trim(),
        status: row.status,
        description: row.description,
        metadata: row.metadata,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: { page: Number(page), limit: Number(limit), total: result.rowCount },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});
