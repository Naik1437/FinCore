import { createHash } from 'node:crypto';
import { pool } from './database.js';
import { redisClient } from './redis.js';

// In-memory fallback lock table for concurrent idempotency protection if Redis is unreachable
const inFlightLocks = new Map<string, number>();

export interface TransferRequestParams {
  sourceWalletId: string;
  beneficiaryId: string;
  amount: number | string;
  currency?: string;
  description: string;
  idempotencyKey?: string;
  userId?: string;
  userRole?: string;
}

export interface TransferResult {
  success: boolean;
  message?: string;
  transaction?: any;
  duplicate?: boolean;
  newBalance?: number;
  statusCode?: number;
  error?: string;
}

export interface RiskGatedTransferResult extends TransferResult {
  riskScore?: number;
  riskTier?: string;
  riskDecision?: string;
  holdId?: string;
  riskFactors?: any[];
  disclaimer?: string;
}

// -----------------------------------------------------------------------------
// Monetary Arithmetic Helpers (Exact 4-decimal fixed point)
// -----------------------------------------------------------------------------
export function toFixedUnits(val: number | string): bigint {
  const str = typeof val === 'number' ? val.toFixed(4) : String(val).trim();
  const [intPart = '0', fracPart = ''] = str.split('.');
  const paddedFrac = fracPart.padEnd(4, '0').slice(0, 4);
  const sign = intPart.startsWith('-') ? -1n : 1n;
  const absInt = intPart.replace('-', '');
  return sign * (BigInt(absInt || '0') * 10000n + BigInt(paddedFrac || '0'));
}

export function formatFromUnits(units: bigint): string {
  const isNegative = units < 0n;
  const absUnits = isNegative ? -units : units;
  const intPart = absUnits / 10000n;
  const fracPart = (absUnits % 10000n).toString().padStart(4, '0');
  return `${isNegative ? '-' : ''}${intPart}.${fracPart}`;
}

// -----------------------------------------------------------------------------
// Concurrent Idempotency & Distributed Lock Management
// -----------------------------------------------------------------------------
export async function acquireIdempotencyLock(key: string, ttlSeconds = 15): Promise<boolean> {
  if (!key) return true;

  // Try Redis distributed lock if connected
  if (redisClient.isOpen) {
    try {
      const lockKey = `idempotency:lock:${key}`;
      const acquired = await redisClient.set(lockKey, 'LOCKED', {
        NX: true,
        EX: ttlSeconds,
      });
      return acquired !== null;
    } catch {
      // Fall through to memory lock
    }
  }

  // In-process fallback lock check
  const now = Date.now();
  const existingExpiry = inFlightLocks.get(key);
  if (existingExpiry && existingExpiry > now) {
    return false; // Lock already held by another concurrent request
  }

  inFlightLocks.set(key, now + ttlSeconds * 1000);
  return true;
}

export async function releaseIdempotencyLock(key: string): Promise<void> {
  if (!key) return;

  if (redisClient.isOpen) {
    try {
      await redisClient.del(`idempotency:lock:${key}`);
    } catch {
      // Ignore Redis delete error
    }
  }
  inFlightLocks.delete(key);
}

export async function getIdempotencyReceipt(key: string): Promise<Record<string, any> | null> {
  if (!key) return null;

  // Check Redis cache first
  if (redisClient.isOpen) {
    try {
      const cached = await redisClient.get(`idempotency:receipt:${key}`);
      if (cached) return JSON.parse(cached);
    } catch {
      // Ignore cache error
    }
  }

  // Check database
  const res = await pool.query('SELECT * FROM transactions WHERE idempotency_key = $1', [key]);
  if (res.rows.length > 0) {
    const row = res.rows[0];
    return {
      requestFingerprint: row.metadata?.requestFingerprint,
      userId: row.metadata?.userId,
      id: row.id,
      walletId: row.wallet_id,
      type: row.type,
      amount: parseFloat(row.amount),
      currency: row.currency.trim(),
      status: row.status,
      description: row.description,
      createdAt: row.created_at,
    };
  }

  return null;
}

export async function storeIdempotencyReceipt(
  key: string,
  receipt: any,
  ttlSeconds = 86400
): Promise<void> {
  if (!key) return;

  if (redisClient.isOpen) {
    try {
      await redisClient.setEx(`idempotency:receipt:${key}`, ttlSeconds, JSON.stringify(receipt));
    } catch {
      // Ignore cache error
    }
  }
}

// -----------------------------------------------------------------------------
// Settlement Account Retrieval (Atomic creation & locking)
// -----------------------------------------------------------------------------
export async function getOrCreateSettlementWallet(
  client: any,
  currency: string
): Promise<{ id: string; balance: string; held_balance: string }> {
  const userRes = await client.query(
    "SELECT id FROM users WHERE email = 'settlement@fincore.internal'"
  );
  let settlementUserId: string;
  if (userRes.rows.length === 0) {
    const newUserRes = await client.query(
      `INSERT INTO users (email, full_name, is_verified, role)
       VALUES ('settlement@fincore.internal', 'FinCore Settlement Treasury', true, 'platform_administrator')
       ON CONFLICT (email) DO UPDATE SET email = EXCLUDED.email
       RETURNING id`
    );
    settlementUserId = newUserRes.rows[0].id;
  } else {
    settlementUserId = userRes.rows[0].id;
  }

  const walletRes = await client.query(
    'SELECT id, balance, held_balance FROM wallets WHERE user_id = $1 AND currency = $2 FOR UPDATE',
    [settlementUserId, currency.toUpperCase()]
  );
  if (walletRes.rows.length === 0) {
    const newWalletRes = await client.query(
      `INSERT INTO wallets (user_id, currency, balance, status)
       VALUES ($1, $2, 0.0000, 'active')
       RETURNING id, balance, held_balance`,
      [settlementUserId, currency.toUpperCase()]
    );
    return newWalletRes.rows[0];
  }
  return walletRes.rows[0];
}

// -----------------------------------------------------------------------------
// Core Atomic Transfer Engine with Deadlock Prevention & Concurrency Control
// -----------------------------------------------------------------------------
export async function executeAtomicTransfer(
  params: TransferRequestParams
): Promise<TransferResult> {
  const {
    sourceWalletId,
    beneficiaryId,
    amount,
    description,
    idempotencyKey: callerKey,
    userId,
    userRole,
  } = params;

  const requestedUnits = toFixedUnits(amount);
  if (requestedUnits <= 0n) {
    return {
      success: false,
      statusCode: 400,
      error: 'Transfer amount must be strictly greater than 0',
    };
  }
  const formattedAmount = formatFromUnits(requestedUnits);

  // 1. Concurrent Idempotency Guard (Lock acquisition)
  const idempotencyKey = callerKey;
  const requestFingerprint = createHash('sha256')
    .update(JSON.stringify([sourceWalletId, beneficiaryId, formattedAmount, description]))
    .digest('hex');
  if (idempotencyKey) {
    const lockAcquired = await acquireIdempotencyLock(idempotencyKey, 15);
    if (!lockAcquired) {
      return {
        success: false,
        statusCode: 409,
        error:
          'Concurrent transfer submission in progress for this idempotency key. Please retry shortly.',
      };
    }

    // Check if duplicate submission already completed
    const existingReceipt = await getIdempotencyReceipt(idempotencyKey);
    if (existingReceipt) {
      await releaseIdempotencyLock(idempotencyKey);
      const {
        requestFingerprint: savedFingerprint,
        userId: savedUserId,
        ...transaction
      } = existingReceipt;
      if (userRole === 'customer' && userId && savedUserId && savedUserId !== userId) {
        return {
          success: false,
          statusCode: 403,
          error: 'Access denied: You do not own the transaction for this idempotency key',
        };
      }
      if (userId && savedFingerprint !== requestFingerprint) {
        return {
          success: false,
          statusCode: 409,
          error: 'Idempotency key already used for a different request',
        };
      }
      const wRes = await pool.query('SELECT balance, user_id FROM wallets WHERE id = $1', [
        sourceWalletId,
      ]);
      if (userRole === 'customer' && userId && wRes.rows[0] && wRes.rows[0].user_id !== userId) {
        return {
          success: false,
          statusCode: 403,
          error: 'Access denied: You do not own the source wallet for this transfer',
        };
      }
      return {
        success: true,
        duplicate: true,
        message: 'Transfer already processed (idempotent duplicate submission)',
        transaction,
        newBalance: wRes.rows[0] ? parseFloat(wRes.rows[0].balance) : 0,
      };
    }
  }

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    // 2. Validate Source Wallet & Ownership Security Check
    const srcWalletRes = await client.query(
      `SELECT id, user_id, balance, held_balance, currency, status, version 
       FROM wallets 
       WHERE id = $1`,
      [sourceWalletId]
    );
    if (srcWalletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, statusCode: 404, error: 'Source wallet not found' };
    }
    const preliminarySourceWallet = srcWalletRes.rows[0];

    // Ownership & Security Check
    if (userRole === 'customer' && userId && preliminarySourceWallet.user_id !== userId) {
      await client.query('ROLLBACK');
      return {
        success: false,
        statusCode: 403,
        error: 'Access denied: You do not own the source wallet for this transfer',
      };
    }

    // 3. Validate Beneficiary
    const benRes = await client.query('SELECT * FROM beneficiaries WHERE id = $1', [beneficiaryId]);
    if (benRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, statusCode: 404, error: 'Beneficiary not found' };
    }
    const beneficiary = benRes.rows[0];
    if (userRole === 'customer' && beneficiary.user_id !== userId) {
      await client.query('ROLLBACK');
      return { success: false, statusCode: 403, error: 'You do not own the beneficiary' };
    }
    const benCurrency = beneficiary.currency.trim().toUpperCase();

    // 4. Retrieve or create Settlement Wallet
    const settlementWallet = await getOrCreateSettlementWallet(client, benCurrency);

    // 5. Deterministic Multi-Wallet Locking (Order by UUID to prevent deadlocks)
    const walletIds = [sourceWalletId, settlementWallet.id].sort();
    const lockedWalletsRes = await client.query(
      `SELECT id, user_id, balance, held_balance, currency, status, version 
       FROM wallets 
       WHERE id = ANY($1::uuid[]) 
       ORDER BY id FOR UPDATE`,
      [walletIds]
    );

    const sourceWallet = lockedWalletsRes.rows.find((w: any) => w.id === sourceWalletId);
    if (!sourceWallet) {
      await client.query('ROLLBACK');
      return { success: false, statusCode: 404, error: 'Source wallet not found' };
    }

    // Secondary ownership check on locked row
    if (userRole === 'customer' && userId && sourceWallet.user_id !== userId) {
      await client.query('ROLLBACK');
      return {
        success: false,
        statusCode: 403,
        error: 'Access denied: You do not own the source wallet for this transfer',
      };
    }

    if (sourceWallet.status !== 'active') {
      await client.query('ROLLBACK');
      return {
        success: false,
        statusCode: 400,
        error: `Wallet is currently ${sourceWallet.status} and cannot process transfers`,
      };
    }

    // 6. Currency Match Verification
    const walletCurrency = sourceWallet.currency.trim().toUpperCase();
    if (walletCurrency !== benCurrency) {
      await client.query('ROLLBACK');
      return {
        success: false,
        statusCode: 400,
        error: `Currency mismatch: source wallet is ${walletCurrency} but beneficiary account is ${benCurrency}`,
      };
    }

    // 7. Available Balance Check (Considering active wallet holds)
    const sourceTotalUnits = toFixedUnits(sourceWallet.balance);
    const sourceHeldUnits = toFixedUnits(sourceWallet.held_balance || 0);
    const availableUnits = sourceTotalUnits - sourceHeldUnits;

    if (availableUnits < requestedUnits) {
      await client.query('ROLLBACK');
      const availableFormatted = formatFromUnits(availableUnits);
      return {
        success: false,
        statusCode: 400,
        error: `Insufficient simulated funds. Available: ${availableFormatted} ${walletCurrency}, Requested: ${formattedAmount} ${walletCurrency}`,
      };
    }

    const fullDesc = `Transfer to ${beneficiary.name} (${beneficiary.bank_name}): ${description}`;

    // 8. Update source wallet balance atomically with version bump
    const sourceUpdateRes = await client.query(
      `UPDATE wallets 
       SET balance = balance - $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING balance`,
      [formattedAmount, sourceWalletId]
    );
    const newSourceBalance = sourceUpdateRes.rows[0].balance;

    // 9. Update settlement wallet balance atomically with version bump
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
          userId,
          beneficiaryId,
          requestFingerprint,
          beneficiaryName: beneficiary.name,
          accountNumber: beneficiary.account_number,
          settlementWalletId: settlementWallet.id,
        }),
        idempotencyKey || null,
      ]
    );
    const txn = txnRes.rows[0];

    // 11. Insert matching DEBIT ledger entry
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

    // 12. Insert matching CREDIT ledger entry (same transaction ID)
    await client.query(
      `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
       VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
      [
        settlementWallet.id,
        txn.id,
        formattedAmount,
        walletCurrency,
        newSettlementBalance,
        `Simulated transfer settlement credit from ${sourceWalletId}`,
      ]
    );

    await client.query('COMMIT');

    const receipt = {
      id: txn.id,
      walletId: txn.wallet_id,
      type: txn.type,
      amount: parseFloat(txn.amount),
      currency: txn.currency.trim(),
      status: txn.status,
      description: txn.description,
      createdAt: txn.created_at,
    };

    if (idempotencyKey) {
      await storeIdempotencyReceipt(idempotencyKey, { ...receipt, requestFingerprint, userId });
    }

    return {
      success: true,
      transaction: receipt,
      duplicate: false,
      newBalance: parseFloat(newSourceBalance),
    };
  } catch (error: any) {
    await client.query('ROLLBACK');
    return {
      success: false,
      statusCode: 500,
      error: error.message || 'Internal transfer processing failure',
    };
  } finally {
    client.release();
    if (idempotencyKey) {
      await releaseIdempotencyLock(idempotencyKey);
    }
  }
}

// -----------------------------------------------------------------------------
// Hold Consistency & Risk Analytics Gated Transfer Engine
// -----------------------------------------------------------------------------
export async function executeHoldGatedTransfer(
  params: TransferRequestParams & { riskEvaluationUrl?: string }
): Promise<RiskGatedTransferResult> {
  const {
    sourceWalletId,
    beneficiaryId,
    amount,
    description,
    idempotencyKey,
    riskEvaluationUrl = (process.env.ANALYTICS_SERVICE_URL || 'http://127.0.0.1:8000') +
      '/api/v1/risk/evaluate',
  } = params;

  const requestedUnits = toFixedUnits(amount);
  if (requestedUnits <= 0n) {
    return { success: false, statusCode: 400, error: 'Transfer amount must be greater than 0' };
  }
  const formattedAmount = formatFromUnits(requestedUnits);

  const client = await pool.connect();
  let holdId: string | null = null;
  let walletCurrency = 'USD';

  try {
    // -------------------------------------------------------------------------
    // STAGE 1: Acquire lock, check available balance, and create active Hold
    // -------------------------------------------------------------------------
    await client.query('BEGIN');

    const walletRes = await client.query('SELECT * FROM wallets WHERE id = $1 FOR UPDATE', [
      sourceWalletId,
    ]);
    if (walletRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return { success: false, statusCode: 404, error: 'Source wallet not found' };
    }
    const wallet = walletRes.rows[0];
    walletCurrency = wallet.currency.trim().toUpperCase();

    const availableUnits = toFixedUnits(wallet.balance) - toFixedUnits(wallet.held_balance || 0);
    if (availableUnits < requestedUnits) {
      await client.query('ROLLBACK');
      return {
        success: false,
        statusCode: 400,
        error: `Insufficient available funds for hold reservation. Available: ${formatFromUnits(availableUnits)} ${walletCurrency}`,
      };
    }

    // Place active hold on wallet
    const holdRes = await client.query(
      `INSERT INTO holds (wallet_id, amount, currency, status, reason, expires_at)
       VALUES ($1, $2::numeric(18, 4), $3, 'active', $4, NOW() + INTERVAL '10 minutes')
       RETURNING id`,
      [
        sourceWalletId,
        formattedAmount,
        walletCurrency,
        `Pre-authorization hold for: ${description}`,
      ]
    );
    holdId = holdRes.rows[0].id;

    // Increment held_balance on wallet
    await client.query(
      `UPDATE wallets 
       SET held_balance = held_balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
       WHERE id = $2`,
      [formattedAmount, sourceWalletId]
    );

    await client.query('COMMIT');
  } catch (err: any) {
    await client.query('ROLLBACK');
    return { success: false, statusCode: 500, error: `Hold reservation failed: ${err.message}` };
  } finally {
    client.release();
  }

  // ---------------------------------------------------------------------------
  // STAGE 2: Risk Analytics Evaluation Gate
  // ---------------------------------------------------------------------------
  let riskScore = 15;
  let riskTier = 'LOW';
  let recommendedDecision = 'APPROVE';
  let riskFactors: any[] = [];
  const complianceDisclaimer =
    'Risk scores represent automated statistical decision support and algorithmic heuristics, not definitive legal proof of fraud or illicit activity.';

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2500);

    const riskResponse = await fetch(riskEvaluationUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-analytics-token': process.env.ANALYTICS_SERVICE_TOKEN || '',
      },
      body: JSON.stringify({
        wallet_id: sourceWalletId,
        amount: formattedAmount,
        currency: walletCurrency,
        beneficiary_id: beneficiaryId,
        is_new_beneficiary: false,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (riskResponse.ok) {
      const riskData = (await riskResponse.json()) as any;
      riskScore = riskData.risk_score ?? 15;
      riskTier = riskData.risk_level ?? 'LOW';
      recommendedDecision = riskData.recommended_decision ?? 'APPROVE';
      riskFactors = riskData.factors ?? [];
    }
  } catch {
    // In-process fallback heuristic if FastAPI is unreachable
    const numericAmt = parseFloat(formattedAmount);
    if (numericAmt >= 50000) {
      riskScore = 95;
      riskTier = 'CRITICAL';
      recommendedDecision = 'REJECT';
      riskFactors = [
        {
          rule_id: 'RULE_CRITICAL_HIGH_VALUE',
          rule_name: 'Extreme High Value Check',
          score_points: 95,
          reason: 'Transaction exceeds automated clearance limits',
        },
      ];
    }
  }

  // ---------------------------------------------------------------------------
  // STAGE 3: Adjudication Decision
  // ---------------------------------------------------------------------------
  const resolutionClient = await pool.connect();
  try {
    await resolutionClient.query('BEGIN');

    // If Risk Decision is not APPROVE (REJECT, MANUAL_REVIEW, STEP_UP_AUTH) or Tier is CRITICAL/HIGH: Release hold & reject
    if (
      recommendedDecision !== 'APPROVE' ||
      riskTier === 'CRITICAL' ||
      riskTier === 'HIGH' ||
      parseFloat(formattedAmount) >= 50000
    ) {
      if (parseFloat(formattedAmount) >= 50000) {
        riskScore = Math.max(riskScore, 95);
        riskTier = 'CRITICAL';
        recommendedDecision = 'REJECT';
      }
      await resolutionClient.query(
        `UPDATE holds SET status = 'released', updated_at = NOW() WHERE id = $1`,
        [holdId]
      );
      await resolutionClient.query(
        `UPDATE wallets 
         SET held_balance = GREATEST(0, held_balance - $1::numeric(18, 4)), version = version + 1, updated_at = NOW() 
         WHERE id = $2`,
        [formattedAmount, sourceWalletId]
      );

      // Record blocked transaction
      const blockedTxnRes = await resolutionClient.query(
        `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata, idempotency_key)
         VALUES ($1, 'transfer', $2::numeric(18, 4), $3, 'failed', $4, $5, $6)
         RETURNING *`,
        [
          sourceWalletId,
          formattedAmount,
          walletCurrency,
          `Blocked by Risk Engine: ${description}`,
          JSON.stringify({ riskScore, riskTier, recommendedDecision, riskFactors }),
          idempotencyKey || null,
        ]
      );

      await resolutionClient.query('COMMIT');

      return {
        success: false,
        statusCode: 422,
        error: `Transfer rejected by automated risk policy: Risk score ${riskScore} (${riskTier})`,
        riskScore,
        riskTier,
        riskDecision: recommendedDecision,
        holdId: holdId || undefined,
        riskFactors,
        disclaimer: complianceDisclaimer,
        transaction: blockedTxnRes.rows[0],
      };
    }

    // Otherwise: Capture hold, update balances, and commit balanced double-entry ledger entries
    const benRes = await resolutionClient.query('SELECT * FROM beneficiaries WHERE id = $1', [
      beneficiaryId,
    ]);
    const beneficiary = benRes.rows[0];

    const settlementWallet = await getOrCreateSettlementWallet(resolutionClient, walletCurrency);

    // Settle hold
    await resolutionClient.query(
      `UPDATE holds SET status = 'settled', updated_at = NOW() WHERE id = $1`,
      [holdId]
    );

    // Deduct held balance and main balance from source wallet
    const sourceUpdateRes = await resolutionClient.query(
      `UPDATE wallets 
       SET balance = balance - $1::numeric(18, 4),
           held_balance = GREATEST(0, held_balance - $1::numeric(18, 4)),
           version = version + 1,
           updated_at = NOW() 
       WHERE id = $2 
       RETURNING balance`,
      [formattedAmount, sourceWalletId]
    );
    const newSourceBalance = sourceUpdateRes.rows[0].balance;

    // Credit settlement wallet
    const settlementUpdateRes = await resolutionClient.query(
      `UPDATE wallets 
       SET balance = balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
       WHERE id = $2 
       RETURNING balance`,
      [formattedAmount, settlementWallet.id]
    );
    const newSettlementBalance = settlementUpdateRes.rows[0].balance;

    // Record completed transaction
    const txnRes = await resolutionClient.query(
      `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata, idempotency_key)
       VALUES ($1, 'transfer', $2::numeric(18, 4), $3, 'completed', $4, $5, $6)
       RETURNING *`,
      [
        sourceWalletId,
        formattedAmount,
        walletCurrency,
        `Risk-cleared transfer to ${beneficiary?.name || 'Beneficiary'}: ${description}`,
        JSON.stringify({
          riskScore,
          riskTier,
          recommendedDecision,
          holdId,
          settlementWalletId: settlementWallet.id,
        }),
        idempotencyKey || null,
      ]
    );
    const txn = txnRes.rows[0];

    // Link transaction to hold
    await resolutionClient.query(`UPDATE holds SET transaction_id = $1 WHERE id = $2`, [
      txn.id,
      holdId,
    ]);

    // Matching DEBIT ledger entry
    await resolutionClient.query(
      `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
       VALUES ($1, $2, 'debit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
      [
        sourceWalletId,
        txn.id,
        formattedAmount,
        walletCurrency,
        newSourceBalance,
        `Transfer debit (cleared from hold ${holdId})`,
      ]
    );

    // Matching CREDIT ledger entry
    await resolutionClient.query(
      `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
       VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, $5::numeric(18, 4), $6)`,
      [
        settlementWallet.id,
        txn.id,
        formattedAmount,
        walletCurrency,
        newSettlementBalance,
        `Settlement credit for transfer ${txn.id}`,
      ]
    );

    await resolutionClient.query('COMMIT');

    return {
      success: true,
      transaction: {
        id: txn.id,
        walletId: txn.wallet_id,
        amount: parseFloat(txn.amount),
        currency: txn.currency.trim(),
        status: txn.status,
        description: txn.description,
        createdAt: txn.created_at,
      },
      newBalance: parseFloat(newSourceBalance),
      riskScore,
      riskTier,
      riskDecision: recommendedDecision,
      holdId: holdId || undefined,
      disclaimer: complianceDisclaimer,
    };
  } catch (error: any) {
    await resolutionClient.query('ROLLBACK');
    return { success: false, statusCode: 500, error: error.message };
  } finally {
    resolutionClient.release();
  }
}

// -----------------------------------------------------------------------------
// Reliable Asynchronous Queue & Dead-Letter Queue (DLQ) Engine
// -----------------------------------------------------------------------------
export async function enqueueTransferJob(params: {
  sourceWalletId: string;
  beneficiaryId: string;
  amount: number | string;
  currency?: string;
  description: string;
  idempotencyKey?: string;
  maxRetries?: number;
}): Promise<any> {
  const {
    sourceWalletId,
    beneficiaryId,
    amount,
    currency = 'USD',
    description,
    idempotencyKey,
    maxRetries = 3,
  } = params;

  const formattedAmount = formatFromUnits(toFixedUnits(amount));

  const res = await pool.query(
    `INSERT INTO transfer_jobs (
       source_wallet_id, beneficiary_id, amount, currency, description, idempotency_key, max_retries, status
     )
     VALUES ($1, $2, $3::numeric(18, 4), $4, $5, $6, $7, 'pending')
     ON CONFLICT (idempotency_key) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [
      sourceWalletId,
      beneficiaryId,
      formattedAmount,
      currency.toUpperCase(),
      description,
      idempotencyKey || null,
      maxRetries,
    ]
  );
  return res.rows[0];
}

export async function processTransferJob(
  jobId: string,
  options?: { forceFailure?: boolean; failureReason?: string }
): Promise<{ status: string; job: any; error?: string }> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const jobRes = await client.query('SELECT * FROM transfer_jobs WHERE id = $1 FOR UPDATE', [
      jobId,
    ]);
    if (jobRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error(`Job ${jobId} not found`);
    }
    const job = jobRes.rows[0];

    // Increment attempts
    const newAttempts = job.attempts + 1;

    // Check for forced simulated failure or processing error
    if (options?.forceFailure) {
      const reason = options.failureReason || 'Simulated network connection timeout';
      if (newAttempts >= job.max_retries) {
        // Move to Dead Letter Queue (DLQ)
        await client.query(
          `UPDATE transfer_jobs 
           SET status = 'dead_letter', attempts = $1, last_error = $2, updated_at = NOW() 
           WHERE id = $3`,
          [newAttempts, reason, jobId]
        );

        await client.query(
          `INSERT INTO dead_letter_queue (
             job_id, idempotency_key, source_wallet_id, amount, currency, failure_reason, attempts, payload
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            job.id,
            job.idempotency_key,
            job.source_wallet_id,
            job.amount,
            job.currency,
            reason,
            newAttempts,
            JSON.stringify(job),
          ]
        );

        await client.query('COMMIT');
        return { status: 'dead_letter', job: { ...job, attempts: newAttempts }, error: reason };
      } else {
        // Mark failed for subsequent retry
        await client.query(
          `UPDATE transfer_jobs 
           SET status = 'failed', attempts = $1, last_error = $2, updated_at = NOW() 
           WHERE id = $3`,
          [newAttempts, reason, jobId]
        );
        await client.query('COMMIT');
        return { status: 'failed', job: { ...job, attempts: newAttempts }, error: reason };
      }
    }

    await client.query('COMMIT');

    // Execute atomic transfer
    const transferResult = await executeAtomicTransfer({
      sourceWalletId: job.source_wallet_id,
      beneficiaryId: job.beneficiary_id,
      amount: parseFloat(job.amount),
      currency: job.currency,
      description: job.description,
      idempotencyKey: job.idempotency_key,
    });

    if (transferResult.success) {
      const updatedJob = await pool.query(
        `UPDATE transfer_jobs 
         SET status = 'completed', attempts = $1, transaction_id = $2, updated_at = NOW() 
         WHERE id = $3 
         RETURNING *`,
        [newAttempts, transferResult.transaction?.id, jobId]
      );
      return { status: 'completed', job: updatedJob.rows[0] };
    } else {
      if (newAttempts >= job.max_retries) {
        await pool.query(
          `UPDATE transfer_jobs 
           SET status = 'dead_letter', attempts = $1, last_error = $2, updated_at = NOW() 
           WHERE id = $3`,
          [newAttempts, transferResult.error, jobId]
        );
        await pool.query(
          `INSERT INTO dead_letter_queue (
             job_id, idempotency_key, source_wallet_id, amount, currency, failure_reason, attempts, payload
           )
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
          [
            job.id,
            job.idempotency_key,
            job.source_wallet_id,
            job.amount,
            job.currency,
            transferResult.error,
            newAttempts,
            JSON.stringify(job),
          ]
        );
        return {
          status: 'dead_letter',
          job: { ...job, attempts: newAttempts },
          error: transferResult.error,
        };
      } else {
        await pool.query(
          `UPDATE transfer_jobs 
           SET status = 'failed', attempts = $1, last_error = $2, updated_at = NOW() 
           WHERE id = $3`,
          [newAttempts, transferResult.error, jobId]
        );
        return {
          status: 'failed',
          job: { ...job, attempts: newAttempts },
          error: transferResult.error,
        };
      }
    }
  } finally {
    client.release();
  }
}

export async function getDeadLetterQueue(resolved = false): Promise<any[]> {
  const res = await pool.query(
    `SELECT * FROM dead_letter_queue WHERE resolved = $1 ORDER BY created_at DESC`,
    [resolved]
  );
  return res.rows;
}

export async function retryDeadLetterJob(dlqId: string): Promise<any> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const dlqRes = await client.query('SELECT * FROM dead_letter_queue WHERE id = $1 FOR UPDATE', [
      dlqId,
    ]);
    if (dlqRes.rows.length === 0) {
      await client.query('ROLLBACK');
      throw new Error(`Dead letter record ${dlqId} not found`);
    }
    const dlqItem = dlqRes.rows[0];

    // Mark resolved in DLQ
    await client.query(
      `UPDATE dead_letter_queue SET resolved = true, resolution_notes = 'Replayed by operator', updated_at = NOW() WHERE id = $1`,
      [dlqId]
    );

    // Reset job for retry
    await client.query(
      `UPDATE transfer_jobs SET status = 'pending', attempts = 0, last_error = NULL, updated_at = NOW() WHERE id = $1`,
      [dlqItem.job_id]
    );

    await client.query('COMMIT');

    // Trigger immediate re-process
    return await processTransferJob(dlqItem.job_id);
  } finally {
    client.release();
  }
}
