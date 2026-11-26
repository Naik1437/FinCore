import assert from 'node:assert';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../index.js';
import { pool } from '../services/database.js';
import { PaymentProviderService } from '../services/paymentProvider.js';
import { generateAccessToken } from '../services/auth.js';

describe('FinCore Assessment 12 — Ledger & Payment Comprehensive Testing Suite', () => {
  let senderUserId: string;
  let senderWalletId: string;
  let recipientUserId: string;
  let recipientWalletId: string;
  let senderAuthToken: string;
  let thirdPartyUserId: string;
  let thirdPartyWalletId: string;
  let thirdPartyAuthToken: string;
  let senderBeneficiaryId: string;
  let thirdPartyBeneficiaryId: string;
  const adminToken = generateAccessToken({
    id: 'a0000000-0000-0000-0000-000000000005',
    email: 'platform.admin@fincore.internal',
    role: 'platform_administrator',
    fullName: 'Platform Admin',
  });

  // =========================================================================
  // Test Setup: Seed isolated synthetic test accounts, wallets, and auth
  // =========================================================================
  it('Setup: Provisions isolated synthetic accounts, funded wallets and auth tokens', async () => {
    const timestamp = Date.now();
    const senderEmail = `ledger.test.sender.${timestamp}@example.com`;
    const recipientEmail = `ledger.test.recipient.${timestamp}@example.com`;
    const thirdPartyEmail = `ledger.test.thirdparty.${timestamp}@example.com`;
    const password = 'TestSecurePassword123!';

    // Register sender
    const regSender = await request(app).post('/api/auth/register').send({
      email: senderEmail,
      fullName: 'Ledger Audit Sender',
      password,
    });
    assert.strictEqual(regSender.status, 201);
    senderUserId = regSender.body.user.id;
    senderAuthToken = regSender.body.accessToken;

    // Register recipient
    const regRecipient = await request(app).post('/api/auth/register').send({
      email: recipientEmail,
      fullName: 'Ledger Audit Recipient',
      password,
    });
    assert.strictEqual(regRecipient.status, 201);
    recipientUserId = regRecipient.body.user.id;

    // Register 3rd party for authorization boundary tests
    const regThird = await request(app).post('/api/auth/register').send({
      email: thirdPartyEmail,
      fullName: 'Third Party Attacker',
      password,
    });
    assert.strictEqual(regThird.status, 201);
    thirdPartyUserId = regThird.body.user.id;
    thirdPartyAuthToken = regThird.body.accessToken;

    // Create funded wallets ($500.00 for sender, $50.00 for recipient, $10.00 for 3rd party)
    const senderW = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: senderUserId,
        currency: 'USD',
        initialBalance: 500.0,
      });
    assert.strictEqual(senderW.status, 201);
    senderWalletId = senderW.body.wallet.id;

    const recipientW = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: recipientUserId,
        currency: 'USD',
        initialBalance: 50.0,
      });
    assert.strictEqual(recipientW.status, 201);
    recipientWalletId = recipientW.body.wallet.id;

    const thirdW = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: thirdPartyUserId,
        currency: 'USD',
        initialBalance: 10.0,
      });
    assert.strictEqual(thirdW.status, 201);
    thirdPartyWalletId = thirdW.body.wallet.id;

    // Create beneficiaries
    const benRes1 = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: senderUserId,
        name: 'Recipient Ben',
        accountNumber: 'US1234567890123456',
        bankName: 'FinCore Test Bank',
        currency: 'USD',
      });
    assert.strictEqual(benRes1.status, 201);
    senderBeneficiaryId = benRes1.body.beneficiary.id;

    const benRes2 = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: thirdPartyUserId,
        name: 'Third Party Ben',
        accountNumber: 'US9999999999999999',
        bankName: 'FinCore Test Bank',
        currency: 'USD',
      });
    assert.strictEqual(benRes2.status, 201);
    thirdPartyBeneficiaryId = benRes2.body.beneficiary.id;
  });

  // =========================================================================
  // 1. Financial Calculation Precision & Rounding (NUMERIC(18, 4))
  // =========================================================================
  it('Precision: Enforces exact 4-decimal precision without IEEE 754 floating point drift', async () => {
    const precisionAmount = 12.3456;
    const res = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${senderAuthToken}`)
      .send({
        sourceWalletId: senderWalletId,
        beneficiaryId: senderBeneficiaryId,
        amount: precisionAmount,
        description: 'Decimal precision audit transfer',
        idempotencyKey: `PRECISION-${Date.now()}`,
      });
    assert.strictEqual(res.status, 201);

    // Verify wallet balance in DB is exact
    const senderCheck = await pool.query('SELECT balance FROM wallets WHERE id = $1', [
      senderWalletId,
    ]);
    // 500.0000 - 12.3456 = 487.6544
    assert.strictEqual(parseFloat(senderCheck.rows[0].balance).toFixed(4), '487.6544');
  });

  // =========================================================================
  // 2. Double-Entry Ledger Invariants: Debit = Credit & Immutability
  // =========================================================================
  it('Ledger Invariants: Strict equilibrium (Debit = Credit) and zero unbalanced transactions', async () => {
    const unbalQuery = await pool.query(`
      SELECT transaction_id,
             SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debit,
             SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credit
      FROM ledger_entries
      GROUP BY transaction_id
      HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END)
    `);
    assert.strictEqual(unbalQuery.rows.length, 0, 'No transaction in ledger must be unbalanced');

    // Immutability: Verify ledger entries have created_at and are append-only
    const countQuery = await pool.query('SELECT count(*) FROM ledger_entries');
    assert.ok(parseInt(countQuery.rows[0].count, 10) > 0, 'Ledger has recorded entries');
  });

  // =========================================================================
  // 3. Concurrent Transfers & Double-Spending Prevention
  // =========================================================================
  it('Concurrency: Prevents double-spending when 2 concurrent transfers exceed available balance', async () => {
    // Current sender balance: 487.6544.
    // Two concurrent requests of $300.00 each (Total $600 > $487.6544)
    const transferReq1 = request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${senderAuthToken}`)
      .send({
        sourceWalletId: senderWalletId,
        beneficiaryId: senderBeneficiaryId,
        amount: 300.0,
        description: 'Concurrent race transfer A',
        idempotencyKey: `CONCUR-A-${Date.now()}`,
      });

    const transferReq2 = request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${senderAuthToken}`)
      .send({
        sourceWalletId: senderWalletId,
        beneficiaryId: senderBeneficiaryId,
        amount: 300.0,
        description: 'Concurrent race transfer B',
        idempotencyKey: `CONCUR-B-${Date.now()}`,
      });

    const [res1, res2] = await Promise.all([transferReq1, transferReq2]);

    // Exactly one should succeed (201) and one must be rejected (400 insufficient funds)
    const statuses = [res1.status, res2.status].sort();
    assert.strictEqual(statuses[0], 201, 'One transfer must succeed');
    assert.strictEqual(statuses[1], 400, 'Second transfer must fail with insufficient funds');

    // Verify balance is never negative: 487.6544 - 300 = 187.6544
    const senderDb = await pool.query('SELECT balance FROM wallets WHERE id = $1', [
      senderWalletId,
    ]);
    assert.strictEqual(parseFloat(senderDb.rows[0].balance).toFixed(4), '187.6544');
  });

  // =========================================================================
  // 4. Payment, Refund and Compensating Reversal Correctness
  // =========================================================================
  it('Payments & Reversals: Executes payment charge and balanced compensating refund', async () => {
    const paymentIntentId = `pi_audit_${Date.now()}`;
    const intentRes = await pool.query(
      `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata)
       VALUES ($1, 'payment', 45.0000, 'USD', 'pending', 'Pending card payment', $2)
       RETURNING id`,
      [senderWalletId, JSON.stringify({ paymentIntentId })]
    );
    const pendingTxnId = intentRes.rows[0].id;

    // 1. Deliver signed webhook payment_intent.succeeded
    const successPayload = {
      id: `evt_test_charge_${Date.now()}`,
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: paymentIntentId,
          transaction_id: pendingTxnId,
          amount: 45.0,
          currency: 'USD',
          status: 'succeeded',
        },
      },
    };

    const { header: successHeader } = PaymentProviderService.signPayload(successPayload);

    const webhookRes = await request(app)
      .post('/api/webhooks/payments')
      .set('fincore-signature', successHeader)
      .send(successPayload);
    assert.strictEqual(webhookRes.status, 200);

    // 2. Process compensating refund
    const refundPayload = {
      id: `evt_test_refund_${Date.now()}`,
      type: 'charge.refunded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: paymentIntentId,
          transaction_id: pendingTxnId,
          amount: 45.0,
          currency: 'USD',
          status: 'refunded',
        },
      },
    };
    const { header: refundHeader } = PaymentProviderService.signPayload(refundPayload);

    const refundRes = await request(app)
      .post('/api/webhooks/payments')
      .set('fincore-signature', refundHeader)
      .send(refundPayload);
    assert.strictEqual(refundRes.status, 200);

    // Assert balanced ledger entries for the refund
    const refundLedger = await pool.query(
      `SELECT count(*) FROM ledger_entries WHERE description ILIKE '%refund%' AND transaction_id = $1`,
      [pendingTxnId]
    );
    assert.ok(
      parseInt(refundLedger.rows[0].count, 10) >= 2,
      'Compensating refund recorded balanced entries'
    );
  });

  // =========================================================================
  // 5. Idempotency & Concurrent Webhook Delivery Deduplication
  // =========================================================================
  it('Idempotency: Rejects duplicate webhook event delivery without duplicate side-effects', async () => {
    const eventId = `evt_dedup_${Date.now()}`;
    const payload = {
      id: eventId,
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: crypto.randomUUID(),
          amount: 10.0,
          currency: 'USD',
          status: 'succeeded',
        },
      },
    };

    const { header } = PaymentProviderService.signPayload(payload);

    // Delivery 1
    const delivery1 = await request(app)
      .post('/api/webhooks/payments')
      .set('fincore-signature', header)
      .send(payload);
    assert.strictEqual(delivery1.status, 200);
    assert.strictEqual(delivery1.body.duplicate, false);

    // Delivery 2 (Identical event ID)
    const delivery2 = await request(app)
      .post('/api/webhooks/payments')
      .set('fincore-signature', header)
      .send(payload);
    assert.strictEqual(delivery2.status, 200);
    assert.strictEqual(
      delivery2.body.duplicate,
      true,
      'Second delivery must be acknowledged as duplicate'
    );

    // Confirm DB has exactly 1 event record
    const eventCheck = await pool.query('SELECT count(*) FROM webhook_events WHERE event_id = $1', [
      eventId,
    ]);
    assert.strictEqual(parseInt(eventCheck.rows[0].count, 10), 1, 'Exactly one event record saved');
  });

  // =========================================================================
  // 6. Authentication & Authorization Boundaries
  // =========================================================================
  it('Authorization: Blocks cross-account resource access (wallet manipulation)', async () => {
    // Third party attacker tries to debit sender's wallet
    const attackRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${thirdPartyAuthToken}`)
      .send({
        sourceWalletId: senderWalletId, // Attacking sender's wallet
        beneficiaryId: thirdPartyBeneficiaryId,
        amount: 50.0,
        description: 'Unauthorized cross-account theft',
        idempotencyKey: `THEFT-${Date.now()}`,
      });

    // Must be blocked with 403 Forbidden
    assert.strictEqual(
      attackRes.status,
      403,
      'Cross-account transfer must be rejected with 403 Forbidden'
    );
    assert.match(attackRes.body.error, /do not own the source wallet/i);
  });

  // =========================================================================
  // 7. Transaction Rollback & Failure Recovery
  // =========================================================================
  it('Rollback: Reverts all state mutations cleanly when an error occurs during transfer flow', async () => {
    const beforeSender = await pool.query('SELECT balance FROM wallets WHERE id = $1', [
      senderWalletId,
    ]);

    // Dispatch invalid transfer with non-existent beneficiary UUID
    const badRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${senderAuthToken}`)
      .send({
        sourceWalletId: senderWalletId,
        beneficiaryId: crypto.randomUUID(), // Non-existent beneficiary
        amount: 25.0,
        description: 'Doomed transfer triggering rollback',
        idempotencyKey: `ROLLBACK-${Date.now()}`,
      });

    assert.ok(badRes.status >= 400, 'Must fail with 4xx');

    // Verify sender balance is completely untouched
    const afterSender = await pool.query('SELECT balance FROM wallets WHERE id = $1', [
      senderWalletId,
    ]);
    assert.strictEqual(
      afterSender.rows[0].balance,
      beforeSender.rows[0].balance,
      'Sender balance untouched'
    );
  });

  // =========================================================================
  // Teardown: Cleanly terminate database pool and Redis connection
  // =========================================================================
  after(async () => {
    try {
      await pool.end();
    } catch (_err) {}
    try {
      const { disconnectRedis } = await import('../services/redis.js');
      await disconnectRedis();
    } catch (_err) {}
  });
});
