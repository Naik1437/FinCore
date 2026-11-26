import type { Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { validateRequest } from '../middleware/validateRequest.js';
import { pool } from '../services/database.js';

export const holdRouter = Router();

const createHoldSchema = z.object({
  body: z.object({
    walletId: z.string().uuid('Invalid wallet UUID format'),
    amount: z.number().positive('Hold amount must be greater than 0'),
    currency: z.string().length(3, 'Currency must be a 3-letter ISO code').default('USD'),
    reason: z.string().min(3, 'Hold reason must be at least 3 characters'),
    expiresInMinutes: z.number().positive().optional(),
    metadata: z.record(z.unknown()).optional(),
  }),
});

const holdParamsSchema = z.object({
  params: z.object({
    id: z.string().uuid('Invalid hold UUID format'),
  }),
});

const listHoldsSchema = z.object({
  query: z.object({
    walletId: z.string().uuid().optional(),
    status: z.enum(['active', 'released', 'settled', 'expired']).optional(),
    page: z.coerce.number().positive().default(1),
    limit: z.coerce.number().positive().max(100).default(50),
  }),
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

holdRouter.post('/', validateRequest(createHoldSchema), async (req, res: Response) => {
  const { walletId, amount, currency, reason, expiresInMinutes, metadata } = req.body;
  const currUpper = currency.toUpperCase();
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock wallet row for update
    const walletRes = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [
      walletId,
    ]);
    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet not found', statusCode: 404 });
    }

    const wallet = walletRes.rows[0];
    if (wallet.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Unprocessable Entity',
        message: `Wallet is ${wallet.status} and cannot place holds`,
        statusCode: 422,
      });
    }

    if (wallet.currency.trim() !== currUpper) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Currency Mismatch',
        message: `Wallet currency ${wallet.currency.trim()} does not match requested hold currency ${currUpper}`,
        statusCode: 400,
      });
    }

    // 2. Check available balance (balance - held_balance)
    const balanceUnits = toFixedUnits(wallet.balance);
    const heldUnits = toFixedUnits(wallet.held_balance || 0);
    const availableUnits = balanceUnits - heldUnits;
    const holdUnits = toFixedUnits(amount);

    if (holdUnits > availableUnits) {
      await client.query('ROLLBACK');
      return res.status(400).json({
        error: 'Insufficient Available Balance',
        message: `Requested hold (${formatFromUnits(holdUnits)} ${currUpper}) exceeds available balance (${formatFromUnits(availableUnits)} ${currUpper})`,
        statusCode: 400,
      });
    }

    const formattedHoldAmount = formatFromUnits(holdUnits);
    let expiresAt: string | null = null;
    if (expiresInMinutes) {
      expiresAt = new Date(Date.now() + expiresInMinutes * 60 * 1000).toISOString();
    }

    // 3. Increment held_balance
    const updatedWalletRes = await client.query(
      `UPDATE wallets 
       SET held_balance = held_balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW()
       WHERE id = $2
       RETURNING balance, held_balance`,
      [formattedHoldAmount, walletId]
    );

    const newHeldBalance = parseFloat(updatedWalletRes.rows[0].held_balance);
    const totalBalance = parseFloat(updatedWalletRes.rows[0].balance);
    const newAvailableBalance = totalBalance - newHeldBalance;

    // 4. Insert hold record
    const holdRes = await client.query(
      `INSERT INTO holds (wallet_id, amount, currency, status, reason, metadata, expires_at)
       VALUES ($1, $2::numeric(18, 4), $3, 'active', $4, $5, $6)
       RETURNING *`,
      [walletId, formattedHoldAmount, currUpper, reason, JSON.stringify(metadata || {}), expiresAt]
    );
    const hold = holdRes.rows[0];

    // 5. Audit log
    await client.query(
      `INSERT INTO financial_audit_logs (entity_type, entity_id, action, actor_id, details)
       VALUES ('hold', $1, 'HOLD_CREATED', 'system', $2)`,
      [
        hold.id,
        JSON.stringify({
          walletId,
          amount: formattedHoldAmount,
          currency: currUpper,
          reason,
          newHeldBalance,
          newAvailableBalance,
        }),
      ]
    );

    await client.query('COMMIT');

    res.status(201).json({
      message: 'Hold placed successfully',
      hold: {
        id: hold.id,
        walletId: hold.wallet_id,
        amount: parseFloat(hold.amount),
        currency: hold.currency.trim(),
        status: hold.status,
        reason: hold.reason,
        expiresAt: hold.expires_at,
        createdAt: hold.created_at,
      },
      wallet: {
        id: walletId,
        totalBalance,
        heldBalance: newHeldBalance,
        availableBalance: newAvailableBalance,
      },
    });
  } catch (_error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to place hold on wallet', statusCode: 500 });
  } finally {
    client.release();
  }
});

holdRouter.get('/', validateRequest(listHoldsSchema), async (req, res: Response) => {
  try {
    const { walletId, status, page = 1, limit = 50 } = req.query as any;
    const offset = (Number(page) - 1) * Number(limit);

    let countQuery = 'SELECT COUNT(*) as count FROM holds WHERE 1=1';
    let dataQuery = 'SELECT * FROM holds WHERE 1=1';
    const params: any[] = [];

    if (walletId) {
      params.push(walletId);
      const clause = ` AND wallet_id = $${params.length}`;
      countQuery += clause;
      dataQuery += clause;
    }
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
      holds: result.rows.map(row => ({
        id: row.id,
        walletId: row.wallet_id,
        transactionId: row.transaction_id,
        amount: parseFloat(row.amount),
        currency: row.currency.trim(),
        status: row.status,
        reason: row.reason,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      })),
      pagination: {
        page: Number(page),
        limit: Number(limit),
        total,
        totalPages: Math.ceil(total / Number(limit)) || 1,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch holds', statusCode: 500 });
  }
});

holdRouter.get('/:id', validateRequest(holdParamsSchema), async (req, res: Response) => {
  try {
    const { id } = req.params;
    const result = await pool.query('SELECT * FROM holds WHERE id = $1', [id]);
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Hold not found', statusCode: 404 });
    }
    const row = result.rows[0];
    res.json({
      hold: {
        id: row.id,
        walletId: row.wallet_id,
        transactionId: row.transaction_id,
        amount: parseFloat(row.amount),
        currency: row.currency.trim(),
        status: row.status,
        reason: row.reason,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
      },
    });
  } catch (_error) {
    res.status(500).json({ error: 'Failed to fetch hold', statusCode: 500 });
  }
});

holdRouter.post('/:id/release', validateRequest(holdParamsSchema), async (req, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock hold row
    const holdRes = await client.query('SELECT * FROM holds WHERE id = $1 FOR UPDATE', [id]);
    if (holdRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Hold not found', statusCode: 404 });
    }

    const hold = holdRes.rows[0];
    if (hold.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Unprocessable Entity',
        message: `Cannot release hold with status ${hold.status}`,
        statusCode: 422,
      });
    }

    // 2. Lock wallet row
    const walletRes = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [
      hold.wallet_id,
    ]);
    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Wallet not found', statusCode: 404 });
    }

    const formattedAmount = formatFromUnits(toFixedUnits(hold.amount));

    // 3. Decrement held_balance
    const updatedWalletRes = await client.query(
      `UPDATE wallets 
       SET held_balance = GREATEST(0, held_balance - $1::numeric(18, 4)), version = version + 1, updated_at = NOW()
       WHERE id = $2
       RETURNING balance, held_balance`,
      [formattedAmount, hold.wallet_id]
    );

    const totalBalance = parseFloat(updatedWalletRes.rows[0].balance);
    const newHeldBalance = parseFloat(updatedWalletRes.rows[0].held_balance);
    const availableBalance = totalBalance - newHeldBalance;

    // 4. Update hold status to released
    await client.query("UPDATE holds SET status = 'released', updated_at = NOW() WHERE id = $1", [
      id,
    ]);

    // 5. Audit log
    await client.query(
      `INSERT INTO financial_audit_logs (entity_type, entity_id, action, actor_id, details)
       VALUES ('hold', $1, 'HOLD_RELEASED', 'system', $2)`,
      [
        id,
        JSON.stringify({
          walletId: hold.wallet_id,
          amount: formattedAmount,
          newHeldBalance,
          availableBalance,
        }),
      ]
    );

    await client.query('COMMIT');

    res.json({
      message: 'Hold released successfully',
      hold: {
        id,
        status: 'released',
      },
      wallet: {
        id: hold.wallet_id,
        totalBalance,
        heldBalance: newHeldBalance,
        availableBalance,
      },
    });
  } catch (_error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to release hold', statusCode: 500 });
  } finally {
    client.release();
  }
});

holdRouter.post('/:id/capture', validateRequest(holdParamsSchema), async (req, res: Response) => {
  const { id } = req.params;
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    // 1. Lock hold row
    const holdRes = await client.query('SELECT * FROM holds WHERE id = $1 FOR UPDATE', [id]);
    if (holdRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Hold not found', statusCode: 404 });
    }

    const hold = holdRes.rows[0];
    if (hold.status !== 'active') {
      await client.query('ROLLBACK');
      return res.status(422).json({
        error: 'Unprocessable Entity',
        message: `Cannot capture hold with status ${hold.status}`,
        statusCode: 422,
      });
    }

    // 2. Lock customer wallet
    const walletRes = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [
      hold.wallet_id,
    ]);
    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Customer wallet not found', statusCode: 404 });
    }

    const customerWallet = walletRes.rows[0];
    const currency = hold.currency.trim();
    const formattedAmount = formatFromUnits(toFixedUnits(hold.amount));

    // 3. Get settlement treasury wallet
    const settlementWallet = await getOrCreateSettlementWallet(client, currency);

    // 4. Decrement both balance and held_balance on customer wallet
    const custUpdateRes = await client.query(
      `UPDATE wallets 
       SET balance = balance - $1::numeric(18, 4),
           held_balance = GREATEST(0, held_balance - $1::numeric(18, 4)),
           version = version + 1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING balance, held_balance`,
      [formattedAmount, customerWallet.id]
    );

    const newCustomerBalance = custUpdateRes.rows[0].balance;
    const newHeldBalance = parseFloat(custUpdateRes.rows[0].held_balance);
    const availableBalance = parseFloat(newCustomerBalance) - newHeldBalance;

    // 5. Credit settlement treasury wallet
    const settUpdateRes = await client.query(
      `UPDATE wallets 
       SET balance = balance + $1::numeric(18, 4),
           version = version + 1,
           updated_at = NOW()
       WHERE id = $2
       RETURNING balance`,
      [formattedAmount, settlementWallet.id]
    );
    const newSettlementBalance = settUpdateRes.rows[0].balance;

    // 6. Insert finalized transaction
    const txnRes = await client.query(
      `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata)
       VALUES ($1, 'payment', $2::numeric(18, 4), $3, 'completed', $4, $5)
       RETURNING *`,
      [
        customerWallet.id,
        formattedAmount,
        currency,
        `Captured hold: ${hold.reason}`,
        JSON.stringify({ holdId: hold.id, capturedAt: new Date().toISOString() }),
      ]
    );
    const txn = txnRes.rows[0];

    // 7. Insert balanced double-entry ledger entries
    // DEBIT customer wallet
    await client.query(
      `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
       VALUES ($1, $2, 'debit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
      [
        customerWallet.id,
        txn.id,
        formattedAmount,
        currency,
        newCustomerBalance,
        `Hold capture debit: ${hold.reason}`,
      ]
    );

    // CREDIT settlement treasury wallet
    await client.query(
      `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
       VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
      [
        settlementWallet.id,
        txn.id,
        formattedAmount,
        currency,
        newSettlementBalance,
        `Hold capture settlement credit for hold ${hold.id.slice(0, 8)}`,
      ]
    );

    // 8. Update hold status to settled
    await client.query(
      "UPDATE holds SET status = 'settled', transaction_id = $1, updated_at = NOW() WHERE id = $2",
      [txn.id, id]
    );

    // 9. Audit log
    await client.query(
      `INSERT INTO financial_audit_logs (entity_type, entity_id, action, actor_id, details)
       VALUES ('hold', $1, 'HOLD_CAPTURED', 'system', $2)`,
      [
        id,
        JSON.stringify({
          transactionId: txn.id,
          amount: formattedAmount,
          currency,
          newCustomerBalance,
          availableBalance,
        }),
      ]
    );

    await client.query('COMMIT');

    res.status(200).json({
      message: 'Hold captured and settled successfully',
      hold: {
        id,
        status: 'settled',
        transactionId: txn.id,
      },
      transaction: {
        id: txn.id,
        amount: parseFloat(txn.amount),
        currency: txn.currency.trim(),
        status: txn.status,
      },
      wallet: {
        id: customerWallet.id,
        balance: parseFloat(newCustomerBalance),
        heldBalance: newHeldBalance,
        availableBalance,
      },
    });
  } catch (_error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: 'Failed to capture hold', statusCode: 500 });
  } finally {
    client.release();
  }
});
