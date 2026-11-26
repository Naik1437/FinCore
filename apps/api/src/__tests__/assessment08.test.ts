import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../index.js';
import { pool } from '../services/database.js';
import { NotificationService } from '../services/notificationService.js';
import { PaymentProviderService } from '../services/paymentProvider.js';
import { generateAccessToken } from '../services/auth.js';

describe('FinCore Assessment 08 — Payment & Notification Integrations Test Suite', () => {
  let testUserId: string;
  let testWalletId: string;
  let testCustomerEmail: string;
  const staffToken = generateAccessToken({
    id: '00000000-0000-0000-0000-000000000008',
    email: 'ops8@fincore.internal',
    role: 'operations',
    fullName: 'Ops Staff 8',
  });

  it('Setup: provisions user and funded wallet for payment integrations', async () => {
    testCustomerEmail = `payments.integration.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@example.com`;
    const userRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        email: testCustomerEmail,
        fullName: 'Payment Integrations Tester',
        phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      });
    assert.strictEqual(userRes.status, 201);
    testUserId = userRes.body.account.id;

    // Create wallet with $500.00
    const walletRes = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        userId: testUserId,
        currency: 'USD',
        initialBalance: 500.0,
      });
    assert.strictEqual(walletRes.status, 201);
    testWalletId = walletRes.body.wallet.id;
  });

  // ===========================================================================
  // 1. Signed Webhook HMAC-SHA256 Verification & Replay Protection
  // ===========================================================================
  describe('1. Signed Webhooks & Signature Verification', () => {
    it('Valid HMAC signature succeeds and verifies successfully', async () => {
      const payload = {
        id: `evt_valid_sig_${Date.now()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_test_01',
            amount: 50.0,
            currency: 'USD',
            status: 'succeeded',
            wallet_id: testWalletId,
          },
        },
      };

      const { header } = PaymentProviderService.signPayload(payload);

      const res = await request(app)
        .post('/api/webhooks/payments')
        .set('fincore-signature', header)
        .send(payload);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.received, true);
      assert.strictEqual(res.body.duplicate, false);
      assert.strictEqual(res.body.eventId, payload.id);
    });

    it('Missing or malformed signature header fails with 400', async () => {
      const payload = { id: 'evt_no_sig', type: 'payment_intent.succeeded', data: { object: {} } };

      const res = await request(app).post('/api/webhooks/payments').send(payload);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Invalid Webhook Signature');
    });

    it('Tampered signature fails with 400 Signature Mismatch', async () => {
      const payload = {
        id: `evt_tampered_${Date.now()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: { object: { amount: 100.0 } },
      };

      const fakeHeader = `t=${Math.floor(Date.now() / 1000)},v1=0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef`;

      const res = await request(app)
        .post('/api/webhooks/payments')
        .set('fincore-signature', fakeHeader)
        .send(payload);

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Invalid Webhook Signature');
      assert.strictEqual(res.body.message, 'Signature mismatch');
    });

    it('Replay protection: rejects event timestamps older than tolerance (5 minutes)', async () => {
      const staleTimestamp = Math.floor(Date.now() / 1000) - 600; // 10 minutes ago
      const payload = {
        id: `evt_stale_${Date.now()}`,
        type: 'payment_intent.succeeded',
        created: staleTimestamp,
        data: { object: { amount: 25.0 } },
      };

      const { header } = PaymentProviderService.signPayload(payload, undefined, staleTimestamp);

      const res = await request(app)
        .post('/api/webhooks/payments')
        .set('fincore-signature', header)
        .send(payload);

      assert.strictEqual(res.status, 400);
      assert.match(res.body.message, /expired/i);
    });
  });

  // ===========================================================================
  // 2. Idempotent Event Deduplication
  // ===========================================================================
  describe('2. Idempotent Event Deduplication', () => {
    it('Identical event ID received twice is detected as duplicate and not reprocessed', async () => {
      const eventId = `evt_dedup_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
      const payload = {
        id: eventId,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_dedup_01',
            amount: 15.0,
            currency: 'USD',
            status: 'succeeded',
            wallet_id: testWalletId,
          },
        },
      };

      const { header } = PaymentProviderService.signPayload(payload);

      // First delivery: processes normally
      const res1 = await request(app)
        .post('/api/webhooks/payments')
        .set('fincore-signature', header)
        .send(payload);

      assert.strictEqual(res1.status, 200);
      assert.strictEqual(res1.body.duplicate, false);

      // Second delivery: detected as duplicate
      const res2 = await request(app)
        .post('/api/webhooks/payments')
        .set('fincore-signature', header)
        .send(payload);

      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.duplicate, true);
      assert.match(res2.body.message, /already processed/i);

      // Verify webhook_events table contains exactly 1 record for this event ID
      const countRes = await pool.query(
        'SELECT COUNT(*) as count FROM webhook_events WHERE event_id = $1',
        [eventId]
      );
      assert.strictEqual(parseInt(countRes.rows[0].count, 10), 1);
    });
  });

  // ===========================================================================
  // 3. Payment Status Synchronization (Success, Failure & Refund)
  // ===========================================================================
  describe('3. Payment Status Synchronization', () => {
    let pendingTxnId: string;

    it('Synchronizes payment_intent.succeeded: settles balance and balanced ledger entries', async () => {
      // 1. Create a pending payment intent transaction
      const intentRes = await pool.query(
        `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata)
         VALUES ($1, 'payment', 75.0000, 'USD', 'pending', 'Pending card payment', '{"paymentIntentId": "pi_sync_test_01"}')
         RETURNING id`,
        [testWalletId]
      );
      pendingTxnId = intentRes.rows[0].id;

      const payload = {
        id: `evt_succ_${Date.now()}`,
        type: 'payment_intent.succeeded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_sync_test_01',
            transaction_id: pendingTxnId,
            amount: 75.0,
            currency: 'USD',
            status: 'succeeded',
            customer_email: testCustomerEmail,
          },
        },
      };

      const { header } = PaymentProviderService.signPayload(payload);

      const res = await request(app)
        .post('/api/webhooks/payments')
        .set('fincore-signature', header)
        .send(payload);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.duplicate, false);

      // Verify transaction status transitioned to 'completed'
      const txnRes = await pool.query('SELECT status FROM transactions WHERE id = $1', [
        pendingTxnId,
      ]);
      assert.strictEqual(txnRes.rows[0].status, 'completed');

      // Verify balanced double-entry ledger entries exist
      const ledgerRes = await pool.query(
        'SELECT entry_type, amount FROM ledger_entries WHERE transaction_id = $1',
        [pendingTxnId]
      );
      assert.strictEqual(ledgerRes.rows.length, 2);
      const debit = ledgerRes.rows.find((r: any) => r.entry_type === 'debit');
      const credit = ledgerRes.rows.find((r: any) => r.entry_type === 'credit');
      assert.strictEqual(parseFloat(debit.amount), 75.0);
      assert.strictEqual(parseFloat(credit.amount), 75.0);
    });

    it('Synchronizes payment_intent.payment_failed: marks transaction failed with reason', async () => {
      const intentRes = await pool.query(
        `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata)
         VALUES ($1, 'payment', 40.0000, 'USD', 'pending', 'Pending failing payment', '{"paymentIntentId": "pi_fail_test_01"}')
         RETURNING id`,
        [testWalletId]
      );
      const failTxnId = intentRes.rows[0].id;

      const payload = {
        id: `evt_fail_${Date.now()}`,
        type: 'payment_intent.payment_failed',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'pi_fail_test_01',
            transaction_id: failTxnId,
            amount: 40.0,
            currency: 'USD',
            status: 'failed',
            failure_reason: 'card_declined_insufficient_funds',
            customer_email: testCustomerEmail,
          },
        },
      };

      const { header } = PaymentProviderService.signPayload(payload);

      const res = await request(app)
        .post('/api/webhooks/payments')
        .set('fincore-signature', header)
        .send(payload);

      assert.strictEqual(res.status, 200);

      // Verify transaction marked failed with recorded failure reason
      const txnRes = await pool.query('SELECT status, metadata FROM transactions WHERE id = $1', [
        failTxnId,
      ]);
      assert.strictEqual(txnRes.rows[0].status, 'failed');
      assert.strictEqual(txnRes.rows[0].metadata.failureReason, 'card_declined_insufficient_funds');
    });

    it('Synchronizes charge.refunded: restores wallet balance and records balanced compensating ledger', async () => {
      // 1. Get baseline balance
      const wBefore = await pool.query('SELECT balance FROM wallets WHERE id = $1', [testWalletId]);
      const balanceBefore = parseFloat(wBefore.rows[0].balance);

      // 2. Insert completed transaction to be refunded ($30.00)
      const txnRes = await pool.query(
        `INSERT INTO transactions (wallet_id, type, amount, currency, status, description)
         VALUES ($1, 'payment', 30.0000, 'USD', 'completed', 'Completed charge to refund')
         RETURNING id`,
        [testWalletId]
      );
      const chargeTxnId = txnRes.rows[0].id;

      const payload = {
        id: `evt_ref_${Date.now()}`,
        type: 'charge.refunded',
        created: Math.floor(Date.now() / 1000),
        data: {
          object: {
            id: 'ch_refund_01',
            transaction_id: chargeTxnId,
            amount: 30.0,
            currency: 'USD',
            status: 'refunded',
            customer_email: testCustomerEmail,
          },
        },
      };

      const { header } = PaymentProviderService.signPayload(payload);

      const res = await request(app)
        .post('/api/webhooks/payments')
        .set('fincore-signature', header)
        .send(payload);

      assert.strictEqual(res.status, 200);

      // Verify transaction marked refunded in metadata
      const updatedTxn = await pool.query(
        'SELECT status, metadata FROM transactions WHERE id = $1',
        [chargeTxnId]
      );
      assert.strictEqual(updatedTxn.rows[0].metadata?.refunded, true);

      // Verify balance restored by $30.00
      const wAfter = await pool.query('SELECT balance FROM wallets WHERE id = $1', [testWalletId]);
      assert.strictEqual(parseFloat(wAfter.rows[0].balance), balanceBefore + 30.0);
    });
  });

  // ===========================================================================
  // 4. Sandbox Notification Delivery (Email & SMS)
  // ===========================================================================
  describe('4. Sandbox Notification Service (Email & SMS)', () => {
    it('Dispatches email receipt on payment success and logs to notifications table', async () => {
      const notification = await NotificationService.send({
        userId: testUserId,
        channel: 'email',
        recipient: testCustomerEmail,
        template: 'payment_success',
        data: {
          amount: '125.00',
          currency: 'USD',
          transactionId: 'TXN-NOTIF-01',
        },
      });

      assert.strictEqual(notification.status, 'delivered');
      assert.strictEqual(notification.channel, 'email');
      assert.match(notification.subject || '', /Payment Receipt/);
      assert.match(notification.body, /125.00 USD/);

      // Query database
      const checkRes = await pool.query('SELECT * FROM notifications WHERE id = $1', [
        notification.id,
      ]);
      assert.strictEqual(checkRes.rows.length, 1);
      assert.strictEqual(checkRes.rows[0].status, 'delivered');
    });

    it('Dispatches SMS alert and handles delivery retries upon simulated failure', async () => {
      const notification = await NotificationService.send({
        userId: testUserId,
        channel: 'sms',
        recipient: '+15559876543',
        template: 'transfer_receipt',
        data: {
          amount: '50.00',
          currency: 'USD',
          beneficiaryName: 'Bob Smith',
          receiptId: 'RCPT-001',
        },
        maxRetries: 3,
        simulateFailure: true,
      });

      assert.strictEqual(notification.status, 'failed');
      assert.strictEqual(notification.attempts, 3);
    });

    it('GET /api/notifications - queries delivery audit trail', async () => {
      const res = await request(app)
        .get(`/api/notifications?userId=${testUserId}`)
        .set('Authorization', `Bearer ${staffToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.count >= 2);
      assert.ok(Array.isArray(res.body.notifications));
    });

    it('POST /api/webhooks/simulate - developer simulation tool triggers end-to-end webhook', async () => {
      const res = await request(app)
        .post('/api/webhooks/simulate')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
        type: 'payment_intent.succeeded',
        amount: 20.0,
        currency: 'USD',
        walletId: testWalletId,
        customerEmail: testCustomerEmail,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.simulated, true);
      assert.ok(res.body.signatureHeader);
      assert.strictEqual(res.body.result.processed, true);
    });
  });

  after(async () => {
    // Teardown connections cleanly so test runner exits
    try {
      await pool.end();
    } catch {}
    try {
      const { disconnectRedis } = await import('../services/redis.js');
      await disconnectRedis();
    } catch {}
  });
});
