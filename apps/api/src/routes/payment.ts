import type { Response } from 'express';
import { Router } from 'express';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { requireResourceOwnership } from '../middleware/auth.js';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';
import { StripeSandboxAdapter } from '../services/stripeAdapter.js';

export const paymentRouter = Router();

const ownsIntent = requireResourceOwnership(async req => {
  const result = await pool.query(
    'SELECT w.user_id FROM transactions t JOIN wallets w ON w.id = t.wallet_id WHERE t.id = $1',
    [req.params.id]
  );
  return result.rows[0]?.user_id;
});

const createIntentSchema = z.object({
  body: z.object({
    walletId: z.string().uuid('Invalid wallet UUID format'),
    amount: z.number().positive('Payment amount must be greater than 0'),
    currency: z.string().length(3, 'Currency must be 3 characters').default('USD'),
    description: z.string().optional(),
    idempotencyKey: z.string().optional(),
    metadata: z.record(z.string(), z.unknown()).optional(),
  }),
});

const intentParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid payment intent UUID format'),
  }),
});

const confirmIntentSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid payment intent UUID format'),
  }),
  body: z
    .object({
      idempotencyKey: z.string().optional(),
    })
    .optional(),
});

// Helper for exact monetary arithmetic (4 decimal places)
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

async function getOrCreateSettlementWallet(
  client: any,
  currency: string
): Promise<{ id: string; balance: string }> {
  const userRes = await client.query(
    "SELECT id FROM users WHERE email = 'settlement@fincore.internal'"
  );
  let userId: string;
  if (userRes.rows.length === 0) {
    const newUser = await client.query(
      `INSERT INTO users (email, full_name, is_verified)
       VALUES ('settlement@fincore.internal', 'FinCore Settlement Treasury', true)
       RETURNING id`
    );
    userId = newUser.rows[0].id;
  } else {
    userId = userRes.rows[0].id;
  }

  const walletRes = await client.query(
    'SELECT id, balance FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE',
    [userId, currency.toUpperCase()]
  );
  if (walletRes.rows.length === 0) {
    const newWallet = await client.query(
      `INSERT INTO wallets (user_id, currency, balance, status)
       VALUES ($1, $2, 0.0000, 'active')
       RETURNING id, balance`,
      [userId, currency.toUpperCase()]
    );
    return { id: newWallet.rows[0].id, balance: newWallet.rows[0].balance };
  }
  return { id: walletRes.rows[0].id, balance: walletRes.rows[0].balance };
}

paymentRouter.post(
  '/intents',
  validateRequest(createIntentSchema),
  requireResourceOwnership(async req => {
    const result = await pool.query('SELECT user_id FROM wallets WHERE id = $1', [
      req.body.walletId,
    ]);
    return result.rows[0]?.user_id;
  }),
  async (req, res: Response) => {
    const { walletId, amount, currency, description, idempotencyKey, metadata } = req.body;
    const currUpper = currency.toUpperCase();
    const scopedIdempotencyKey = idempotencyKey
      ? createHash('sha256')
          .update(
            JSON.stringify([
              'payment-intent',
              req.user?.id,
              idempotencyKey,
              walletId,
              amount,
              currUpper,
              description || '',
            ])
          )
          .digest('hex')
      : null;

    try {
      // 1. Idempotency check
      if (scopedIdempotencyKey) {
        const existingTxn = await pool.query(
          "SELECT * FROM transactions WHERE idempotency_key = $1 AND wallet_id = $2 AND type = 'payment'",
          [scopedIdempotencyKey, walletId]
        );
        if (existingTxn.rows.length > 0) {
          const row = existingTxn.rows[0];
          return res.status(200).json({
            message: 'Payment intent already exists (idempotent replay)',
            paymentIntent: {
              id: row.id,
              clientSecret: `pi_sec_${row.id}`,
              walletId: row.wallet_id,
              amount: parseFloat(row.amount),
              currency: row.currency.trim(),
              status: row.status === 'completed' ? 'succeeded' : row.status,
              description: row.description,
              metadata: row.metadata,
              createdAt: row.created_at,
            },
            duplicate: true,
          });
        }
      }

      // 2. Validate wallet exists and is active
      const walletRes = await pool.query('SELECT * FROM wallets WHERE id = $1', [walletId]);
      if (walletRes.rows.length === 0) {
        return res.status(404).json({ error: 'Wallet not found', statusCode: 404 });
      }
      const wallet = walletRes.rows[0];
      if (wallet.status !== 'active') {
        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: `Wallet is ${wallet.status} and cannot initiate payments`,
          statusCode: 422,
        });
      }

      if (wallet.currency.trim() !== currUpper) {
        return res.status(400).json({
          error: 'Currency Mismatch',
          message: `Wallet currency ${wallet.currency.trim()} does not match payment intent currency ${currUpper}`,
          statusCode: 400,
        });
      }

      const formattedAmount = formatFromUnits(toFixedUnits(amount));

      // Optional Stripe Test Mode integration
      let stripeIntent: { id: string; clientSecret: string; status: string } | null = null;
      if (StripeSandboxAdapter.isConfigured()) {
        try {
          stripeIntent = await StripeSandboxAdapter.createPaymentIntent({
            amount: parseFloat(formattedAmount),
            currency: currUpper,
            description: description || 'FinCore Sandbox Payment Intent',
            idempotencyKey: scopedIdempotencyKey || undefined,
            metadata: { walletId, provider: 'stripe_test' },
          });
        } catch (_stripeErr) {
          // Seamless fallback to FinCore simulated intent
        }
      }

      const result = await pool.query(
        `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata, idempotency_key)
       VALUES ($1, 'payment', $2::numeric(18, 4), $3, 'pending', $4, $5, $6)
       RETURNING *`,
        [
          walletId,
          formattedAmount,
          currUpper,
          description || 'Payment intent',
          JSON.stringify({
            ...(metadata || {}),
            intentType: 'payment_intent',
            requiresConfirmation: true,
            stripePaymentIntentId: stripeIntent?.id,
            stripeClientSecret: stripeIntent?.clientSecret,
          }),
          scopedIdempotencyKey,
        ]
      );

      const row = result.rows[0];

      res.status(201).json({
        message: 'Payment intent created',
        paymentIntent: {
          id: row.id,
          clientSecret: stripeIntent?.clientSecret || `pi_sec_${row.id}`,
          walletId: row.wallet_id,
          amount: parseFloat(row.amount),
          currency: row.currency.trim(),
          status: 'requires_confirmation',
          description: row.description,
          metadata: row.metadata,
          createdAt: row.created_at,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to create payment intent', statusCode: 500 });
    }
  }
);

paymentRouter.get(
  '/intents/:id',
  validateRequest(intentParamsSchema),
  ownsIntent,
  async (req, res: Response) => {
    try {
      const { id } = req.params;
      const result = await pool.query(
        "SELECT * FROM transactions WHERE id = $1 AND type = 'payment'",
        [id]
      );
      if (result.rows.length === 0) {
        return res.status(404).json({ error: 'Payment intent not found', statusCode: 404 });
      }
      const row = result.rows[0];
      res.json({
        paymentIntent: {
          id: row.id,
          clientSecret: `pi_sec_${row.id}`,
          walletId: row.wallet_id,
          amount: parseFloat(row.amount),
          currency: row.currency.trim(),
          status:
            row.status === 'completed'
              ? 'succeeded'
              : row.status === 'pending'
                ? 'requires_confirmation'
                : row.status,
          description: row.description,
          metadata: row.metadata,
          createdAt: row.created_at,
          updatedAt: row.updated_at,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to fetch payment intent', statusCode: 500 });
    }
  }
);

paymentRouter.post(
  '/intents/:id/confirm',
  validateRequest(confirmIntentSchema),
  async (req, res: Response) => {
    const { id } = req.params;
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Fetch payment intent transaction with row lock
      const txnRes = await client.query(
        "SELECT * FROM transactions WHERE id = $1 AND type = 'payment' FOR UPDATE",
        [id]
      );
      if (txnRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Payment intent not found', statusCode: 404 });
      }

      const txn = txnRes.rows[0];

      if (txn.status === 'completed') {
        await client.query('ROLLBACK');
        return res.status(200).json({
          message: 'Payment intent already confirmed and processed',
          paymentIntent: {
            id: txn.id,
            status: 'succeeded',
            amount: parseFloat(txn.amount),
            currency: txn.currency.trim(),
          },
          duplicate: true,
        });
      }

      if (txn.status === 'cancelled' || txn.status === 'failed') {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: `Cannot confirm payment intent with status ${txn.status}`,
          statusCode: 422,
        });
      }

      // 2. Lock payer wallet
      const walletRes = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [
        txn.wallet_id,
      ]);
      if (walletRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Payer wallet not found', statusCode: 404 });
      }

      const wallet = walletRes.rows[0];
      if (wallet.status !== 'active') {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: `Payer wallet is ${wallet.status} and cannot authorize payments`,
          statusCode: 422,
        });
      }

      // 3. Exact monetary arithmetic check
      const currentBalanceUnits = toFixedUnits(wallet.balance);
      const paymentAmountUnits = toFixedUnits(txn.amount);

      if (currentBalanceUnits < paymentAmountUnits) {
        await client.query(
          "UPDATE transactions SET status = 'failed', updated_at = NOW() WHERE id = $1",
          [id]
        );
        await client.query('COMMIT');
        return res.status(400).json({
          error: 'Insufficient Funds',
          message: `Available balance (${wallet.currency.trim()} ${parseFloat(
            wallet.balance
          ).toFixed(2)}) is less than payment amount (${wallet.currency.trim()} ${parseFloat(
            txn.amount
          ).toFixed(2)})`,
          statusCode: 400,
        });
      }

      const formattedAmount = formatFromUnits(paymentAmountUnits);

      // 4. Get settlement wallet
      const settlementWallet = await getOrCreateSettlementWallet(client, wallet.currency.trim());

      // 5. Update payer balance
      const payerUpdateRes = await client.query(
        `UPDATE wallets 
         SET balance = balance - $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING balance`,
        [formattedAmount, wallet.id]
      );
      const newPayerBalance = payerUpdateRes.rows[0].balance;

      // 6. Update settlement balance
      const settlementUpdateRes = await client.query(
        `UPDATE wallets 
         SET balance = balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING balance`,
        [formattedAmount, settlementWallet.id]
      );
      const newSettlementBalance = settlementUpdateRes.rows[0].balance;

      // 7. Insert matching double-entry ledger records
      await client.query(
        `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
         VALUES ($1, $2, 'debit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
        [
          wallet.id,
          txn.id,
          formattedAmount,
          wallet.currency.trim(),
          newPayerBalance,
          `Payment debit for ${txn.description || 'payment intent'}`,
        ]
      );

      await client.query(
        `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
         VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
        [
          settlementWallet.id,
          txn.id,
          formattedAmount,
          wallet.currency.trim(),
          newSettlementBalance,
          `Payment settlement credit from wallet ${wallet.id.slice(0, 8)}`,
        ]
      );

      // 8. Update transaction status to completed
      const updatedTxnRes = await client.query(
        `UPDATE transactions 
         SET status = 'completed', updated_at = NOW(),
             metadata = metadata || '{"confirmed": true, "succeededAt": "${new Date().toISOString()}"}'::jsonb
         WHERE id = $1
         RETURNING *`,
        [id]
      );
      const updatedTxn = updatedTxnRes.rows[0];

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Payment intent confirmed and settled successfully',
        paymentIntent: {
          id: updatedTxn.id,
          walletId: updatedTxn.wallet_id,
          amount: parseFloat(updatedTxn.amount),
          currency: updatedTxn.currency.trim(),
          status: 'succeeded',
          description: updatedTxn.description,
          createdAt: updatedTxn.created_at,
          updatedAt: updatedTxn.updated_at,
        },
        newBalance: parseFloat(newPayerBalance),
      });
    } catch (_error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Failed to confirm payment intent', statusCode: 500 });
    } finally {
      client.release();
    }
  }
);

paymentRouter.post(
  '/intents/:id/cancel',
  validateRequest(intentParamsSchema),
  ownsIntent,
  async (req, res: Response) => {
    const { id } = req.params;
    try {
      const txnRes = await pool.query(
        "SELECT * FROM transactions WHERE id = $1 AND type = 'payment'",
        [id]
      );
      if (txnRes.rows.length === 0) {
        return res.status(404).json({ error: 'Payment intent not found', statusCode: 404 });
      }

      const txn = txnRes.rows[0];
      if (txn.status === 'completed') {
        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: 'Cannot cancel an already completed payment intent; use refund instead',
          statusCode: 422,
        });
      }

      const result = await pool.query(
        "UPDATE transactions SET status = 'cancelled', updated_at = NOW() WHERE id = $1 RETURNING *",
        [id]
      );

      res.json({
        message: 'Payment intent cancelled successfully',
        paymentIntent: {
          id: result.rows[0].id,
          status: 'cancelled',
          updatedAt: result.rows[0].updated_at,
        },
      });
    } catch (_error) {
      res.status(500).json({ error: 'Failed to cancel payment intent', statusCode: 500 });
    }
  }
);
