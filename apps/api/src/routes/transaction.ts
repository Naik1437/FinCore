import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import {
  enqueueTransferJob,
  executeAtomicTransfer,
  executeHoldGatedTransfer,
  getDeadLetterQueue,
  processTransferJob,
  retryDeadLetterJob,
} from '../services/consistencyEngine.js';
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

const refundSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid transaction UUID format'),
  }),
  body: z.object({
    amount: z.number().positive('Refund amount must be strictly greater than 0').optional(),
    reason: z.string().min(3, 'Refund reason must be at least 3 characters'),
    idempotencyKey: z.string().optional(),
  }),
});

const reversalSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid transaction UUID format'),
  }),
  body: z.object({
    reason: z.string().min(3, 'Reversal reason must be at least 3 characters'),
    idempotencyKey: z.string().optional(),
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
  const userRes = await client.query(
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

  const walletRes = await client.query(
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
transactionRouter.post('/transfer', validateRequest(transferSchema), async (req, res: Response) => {
  const { sourceWalletId, beneficiaryId, amount, description, idempotencyKey } = req.body;

  if (req.user?.role === 'customer') {
    const wallet = await pool.query('SELECT user_id FROM wallets WHERE id = $1', [sourceWalletId]);
    if (wallet.rows[0]?.user_id !== req.user.id) {
      return res.status(403).json({
        error: 'You do not own the source wallet',
        message: 'Access denied: You do not own the source wallet for this transfer',
        statusCode: 403,
      });
    }
  }

  // 1. Secondary duplicate check (recent identical transfer without idempotency key within 5 seconds)
  if (!idempotencyKey) {
    const formattedAmount = formatFromUnits(toFixedUnits(amount));
    const benRes = await pool.query('SELECT name, bank_name FROM beneficiaries WHERE id = $1', [
      beneficiaryId,
    ]);
    const benName = benRes.rows[0]?.name || '';
    const benBank = benRes.rows[0]?.bank_name || '';
    const fullDesc = `Transfer to ${benName} (${benBank}): ${description}`;

    const recentDupRes = await pool.query(
      `SELECT * FROM transactions 
         WHERE wallet_id = $1 
           AND type = 'transfer' 
           AND amount = $2::numeric(18, 4) 
           AND description = $3 
           AND created_at >= NOW() - INTERVAL '5 seconds'`,
      [sourceWalletId, formattedAmount, fullDesc]
    );
    if (recentDupRes.rows.length > 0) {
      const existing = recentDupRes.rows[0];
      const wRes = await pool.query('SELECT balance FROM wallets WHERE id = $1', [sourceWalletId]);
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
        newBalance: wRes.rows[0] ? parseFloat(wRes.rows[0].balance) : 0,
      });
    }
  }

  // 2. Execute via Transfer Consistency Engine
  const result = await executeAtomicTransfer({
    sourceWalletId,
    beneficiaryId,
    amount,
    description,
    idempotencyKey,
    userId: req.user?.id,
    userRole: req.user?.role,
  });

  if (!result.success) {
    const statusCode = result.statusCode || 400;
    return res.status(statusCode).json({
      error: result.error,
      message: result.error,
      statusCode,
    });
  }

  if (result.duplicate) {
    return res.status(200).json({
      message: result.message,
      transaction: result.transaction,
      duplicate: true,
      newBalance: result.newBalance,
    });
  }

  return res.status(201).json({
    message: 'Transfer completed successfully',
    transaction: result.transaction,
    newBalance: result.newBalance,
  });
});

// Assessment 07: Hold-gated transfer with Risk Analytics evaluation
transactionRouter.post(
  '/transfer-with-risk',
  validateRequest(transferSchema),
  async (req, res: Response) => {
    const { sourceWalletId, beneficiaryId, amount, description, idempotencyKey } = req.body;
    const result = await executeHoldGatedTransfer({
      sourceWalletId,
      beneficiaryId,
      amount,
      description,
      idempotencyKey,
      userId: req.user?.id,
      userRole: req.user?.role,
    });

    if (!result.success) {
      return res.status(result.statusCode || 422).json({
        error: result.error,
        riskScore: result.riskScore,
        riskTier: result.riskTier,
        riskDecision: result.riskDecision,
        holdId: result.holdId,
        riskFactors: result.riskFactors,
        disclaimer: result.disclaimer,
      });
    }

    return res.status(201).json({
      message: 'Risk-cleared transfer completed successfully',
      transaction: result.transaction,
      newBalance: result.newBalance,
      riskScore: result.riskScore,
      riskTier: result.riskTier,
      riskDecision: result.riskDecision,
      holdId: result.holdId,
      disclaimer: result.disclaimer,
    });
  }
);

// Assessment 07: Asynchronous reliable transfer queue
transactionRouter.post('/queue/enqueue', async (req, res: Response) => {
  try {
    const {
      sourceWalletId,
      beneficiaryId,
      amount,
      currency,
      description,
      idempotencyKey,
      maxRetries,
    } = req.body;
    if (!sourceWalletId || !beneficiaryId || !amount || !description) {
      return res.status(400).json({ error: 'Missing required transfer job parameters' });
    }
    const job = await enqueueTransferJob({
      sourceWalletId,
      beneficiaryId,
      amount,
      currency,
      description,
      idempotencyKey,
      maxRetries,
    });
    return res.status(202).json({
      message: 'Transfer job enqueued successfully for asynchronous processing',
      job,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to enqueue transfer job' });
  }
});

transactionRouter.post('/queue/process', async (req, res: Response) => {
  try {
    const { jobId, forceFailure, failureReason } = req.body;
    if (!jobId) {
      return res.status(400).json({ error: 'Job ID is required' });
    }
    const processResult = await processTransferJob(jobId, { forceFailure, failureReason });
    return res.json(processResult);
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to process queue job' });
  }
});

transactionRouter.get('/queue/dlq', async (req, res: Response) => {
  try {
    const resolved = req.query.resolved === 'true';
    const deadLetters = await getDeadLetterQueue(resolved);
    return res.json({
      count: deadLetters.length,
      deadLetters,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to query dead letter queue' });
  }
});

transactionRouter.post('/queue/dlq/:id/retry', async (req, res: Response) => {
  try {
    const dlqId = req.params.id;
    const retryResult = await retryDeadLetterJob(dlqId);
    return res.json({
      message: 'Dead letter job re-queued and processed',
      result: retryResult,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error.message || 'Failed to retry dead letter job' });
  }
});

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
        [
          walletId,
          type,
          amount,
          currency.toUpperCase(),
          description || null,
          JSON.stringify(metadata || {}),
        ]
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

transactionRouter.post('/:id/refund', validateRequest(refundSchema), async (req, res: Response) => {
  const { id } = req.params;
  const { amount, reason, idempotencyKey } = req.body;

  // Authorization check: customers cannot process direct refunds
  if (req.user && req.user.role === 'customer') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Refunds can only be processed by authorized support or finance administrators',
      statusCode: 403,
    });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Idempotency check
    if (idempotencyKey) {
      const dupRes = await client.query('SELECT * FROM transactions WHERE idempotency_key = $1', [
        idempotencyKey,
      ]);
      if (dupRes.rows.length > 0) {
        await client.query('ROLLBACK');
        const dup = dupRes.rows[0];
        return res.status(200).json({
          message: 'Refund already processed (idempotent submission)',
          refund: {
            id: dup.id,
            walletId: dup.wallet_id,
            amount: parseFloat(dup.amount),
            currency: dup.currency.trim(),
            status: dup.status,
            description: dup.description,
            createdAt: dup.created_at,
          },
          duplicate: true,
        });
      }
    }

    // 2. Fetch original transaction with lock
    const txnRes = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [id]);
    if (txnRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Transaction not found', statusCode: 404 });
    }

    const origTxn = txnRes.rows[0];
    if (origTxn.status !== 'completed') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Unprocessable Entity',
        message: `Only completed transactions can be refunded (current status: ${origTxn.status})`,
        statusCode: 422,
      });
    }

    if (origTxn.metadata?.isRefund === true || origTxn.metadata?.isRefund === 'true') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Unprocessable Entity',
        message: 'Cannot refund a refund transaction',
        statusCode: 422,
      });
    }

    // 3. Calculate previous refunds
    const prevRefundsRes = await client.query(
      "SELECT COALESCE(SUM(amount), 0) as total_refunded FROM transactions WHERE metadata->>'originalTransactionId' = $1 AND status = 'completed'",
      [id]
    );
    const totalAlreadyRefundedUnits = toFixedUnits(prevRefundsRes.rows[0].total_refunded || 0);
    const originalUnits = toFixedUnits(origTxn.amount);
    const remainingUnits = originalUnits - totalAlreadyRefundedUnits;

    if (remainingUnits <= 0n) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Already Fully Refunded',
        message: 'This transaction has already been fully refunded',
        statusCode: 400,
      });
    }

    const requestedRefundUnits = amount !== undefined ? toFixedUnits(amount) : remainingUnits;
    if (requestedRefundUnits > remainingUnits) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Refund Limit Exceeded',
        message: `Requested refund (${formatFromUnits(requestedRefundUnits)}) exceeds remaining refundable balance (${formatFromUnits(remainingUnits)})`,
        statusCode: 400,
      });
    }

    const formattedRefundAmount = formatFromUnits(requestedRefundUnits);
    const currency = origTxn.currency.trim();

    // 4. Lock customer wallet
    const walletRes = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [
      origTxn.wallet_id,
    ]);
    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Customer wallet not found', statusCode: 404 });
    }
    const customerWallet = walletRes.rows[0];

    // 5. Get settlement treasury wallet
    const settlementWallet = await getOrCreateSettlementWallet(client, currency);

    // 6. Update balances: credit customer wallet, debit settlement wallet
    const custUpdateRes = await client.query(
      `UPDATE wallets 
         SET balance = balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING balance`,
      [formattedRefundAmount, customerWallet.id]
    );
    const newCustomerBalance = custUpdateRes.rows[0].balance;

    const settUpdateRes = await client.query(
      `UPDATE wallets 
         SET balance = balance - $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
         WHERE id = $2 
         RETURNING balance`,
      [formattedRefundAmount, settlementWallet.id]
    );
    const newSettlementBalance = settUpdateRes.rows[0].balance;

    // 7. Insert refund transaction record
    const refundDesc = `Refund for txn ${id.slice(0, 8)}: ${reason}`;
    const refundTxnRes = await client.query(
      `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata, idempotency_key)
         VALUES ($1, 'deposit', $2::numeric(18, 4), $3, 'completed', $4, $5, $6)
         RETURNING *`,
      [
        customerWallet.id,
        formattedRefundAmount,
        currency,
        refundDesc,
        JSON.stringify({
          isRefund: true,
          originalTransactionId: id,
          refundReason: reason,
          settlementWalletId: settlementWallet.id,
        }),
        idempotencyKey || null,
      ]
    );
    const refundTxn = refundTxnRes.rows[0];

    // 8. Balanced double-entry ledger entries:
    // CREDIT customer wallet
    await client.query(
      `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
         VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
      [
        customerWallet.id,
        refundTxn.id,
        formattedRefundAmount,
        currency,
        newCustomerBalance,
        `Refund credit for transaction ${id.slice(0, 8)}`,
      ]
    );

    // DEBIT settlement wallet
    await client.query(
      `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
         VALUES ($1, $2, 'debit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
      [
        settlementWallet.id,
        refundTxn.id,
        formattedRefundAmount,
        currency,
        newSettlementBalance,
        `Settlement debit for refund ${refundTxn.id.slice(0, 8)}`,
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Refund processed successfully',
      refund: {
        id: refundTxn.id,
        originalTransactionId: id,
        walletId: refundTxn.wallet_id,
        amount: parseFloat(refundTxn.amount),
        currency: refundTxn.currency.trim(),
        status: refundTxn.status,
        description: refundTxn.description,
        createdAt: refundTxn.created_at,
      },
      newBalance: parseFloat(newCustomerBalance),
    });
  } catch (_error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to process refund', statusCode: 500 });
  } finally {
    client.release();
  }
});

transactionRouter.post(
  '/:id/reversal',
  validateRequest(reversalSchema),
  async (req, res: Response) => {
    const { id } = req.params;
    const { reason, idempotencyKey: _idempotencyKey } = req.body;

    // Authorization check: customers cannot reverse transactions
    if (req.user && req.user.role === 'customer') {
      return res.status(403).json({
        error: 'Forbidden',
        message:
          'Transaction reversals can only be initiated by authorized support or finance administrators',
        statusCode: 403,
      });
    }

    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      // 1. Fetch original transaction with lock
      const txnRes = await client.query('SELECT * FROM transactions WHERE id = $1 FOR UPDATE', [
        id,
      ]);
      if (txnRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Transaction not found', statusCode: 404 });
      }

      const origTxn = txnRes.rows[0];
      if (origTxn.metadata?.reversed === true || origTxn.metadata?.reversed === 'true') {
        await client.query('ROLLBACK');
        return res.status(409).json({
          error: 'Conflict',
          message: 'Transaction has already been reversed',
          statusCode: 409,
        });
      }

      if (origTxn.status !== 'completed') {
        await client.query('ROLLBACK');
        return res.status(422).json({
          error: 'Unprocessable Entity',
          message: `Only completed transactions can be reversed (current status: ${origTxn.status})`,
          statusCode: 422,
        });
      }

      const currency = origTxn.currency.trim();
      const amountUnits = toFixedUnits(origTxn.amount);
      const formattedAmount = formatFromUnits(amountUnits);

      // 2. Lock customer wallet
      const walletRes = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [
        origTxn.wallet_id,
      ]);
      if (walletRes.rows.length === 0) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Wallet not found', statusCode: 404 });
      }
      const customerWallet = walletRes.rows[0];

      // 3. Settlement wallet
      const settlementWallet = await getOrCreateSettlementWallet(client, currency);

      let newCustomerBalance: string;
      let newSettlementBalance: string;

      if (origTxn.type === 'deposit') {
        // Original was credit to customer, debit from settlement
        // Reversal debits customer, credits settlement
        const custUnits = toFixedUnits(customerWallet.balance);
        if (custUnits < amountUnits) {
          await client.query('ROLLBACK');
          return res.status(400).json({
            error: 'Insufficient Funds',
            message: 'Wallet balance is insufficient to reverse deposit',
            statusCode: 400,
          });
        }
        const custRes = await client.query(
          'UPDATE wallets SET balance = balance - $1::numeric(18, 4), version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING balance',
          [formattedAmount, customerWallet.id]
        );
        newCustomerBalance = custRes.rows[0].balance;

        const settRes = await client.query(
          'UPDATE wallets SET balance = balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING balance',
          [formattedAmount, settlementWallet.id]
        );
        newSettlementBalance = settRes.rows[0].balance;

        await client.query(
          `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
           VALUES ($1, $2, 'debit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
          [
            customerWallet.id,
            origTxn.id,
            formattedAmount,
            currency,
            newCustomerBalance,
            `Reversal debit: ${reason}`,
          ]
        );
        await client.query(
          `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
           VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
          [
            settlementWallet.id,
            origTxn.id,
            formattedAmount,
            currency,
            newSettlementBalance,
            `Reversal settlement credit: ${reason}`,
          ]
        );
      } else {
        // Original was transfer/payment/withdrawal (debited customer, credited settlement)
        // Reversal credits customer, debits settlement
        const custRes = await client.query(
          'UPDATE wallets SET balance = balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING balance',
          [formattedAmount, customerWallet.id]
        );
        newCustomerBalance = custRes.rows[0].balance;

        const settRes = await client.query(
          'UPDATE wallets SET balance = balance - $1::numeric(18, 4), version = version + 1, updated_at = NOW() WHERE id = $2 RETURNING balance',
          [formattedAmount, settlementWallet.id]
        );
        newSettlementBalance = settRes.rows[0].balance;

        await client.query(
          `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
           VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
          [
            customerWallet.id,
            origTxn.id,
            formattedAmount,
            currency,
            newCustomerBalance,
            `Reversal credit: ${reason}`,
          ]
        );
        await client.query(
          `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
           VALUES ($1, $2, 'debit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
          [
            settlementWallet.id,
            origTxn.id,
            formattedAmount,
            currency,
            newSettlementBalance,
            `Reversal settlement debit: ${reason}`,
          ]
        );
      }

      // 4. Update transaction status to cancelled with reversal metadata
      const updatedTxnRes = await client.query(
        `UPDATE transactions 
         SET status = 'cancelled', updated_at = NOW(),
             metadata = metadata || jsonb_build_object('reversed', true, 'reversalReason', $2::text, 'reversedAt', NOW())
         WHERE id = $1
         RETURNING *`,
        [id, reason]
      );

      await client.query('COMMIT');

      res.status(200).json({
        message: 'Transaction reversed successfully',
        transaction: {
          id: updatedTxnRes.rows[0].id,
          status: 'cancelled',
          reversed: true,
          reason,
          newBalance: parseFloat(newCustomerBalance),
        },
      });
    } catch (_error) {
      await client.query('ROLLBACK');
      res.status(500).json({ error: 'Failed to reverse transaction', statusCode: 500 });
    } finally {
      client.release();
    }
  }
);

transactionRouter.get(
  '/:id',
  validateRequest(transactionParamsSchema),
  async (req, res: Response) => {
    try {
      const result = await pool.query(
        'SELECT t.* FROM transactions t JOIN wallets w ON w.id = t.wallet_id WHERE t.id = $1 AND ($2::uuid IS NULL OR w.user_id = $2)',
        [req.params.id, req.user?.role === 'customer' ? req.user.id : null]
      );
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

    if (req.user?.role === 'customer') {
      params.push(req.user.id);
      queryStr += ' AND wallet_id IN (SELECT id FROM wallets WHERE user_id = $1)';
    }
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
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total: result.rowCount ?? 0,
        totalPages: Math.ceil((result.rowCount ?? 0) / Number(limit)) || 1,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch transactions' });
  }
});
