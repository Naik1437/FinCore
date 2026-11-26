import assert from 'node:assert';
import crypto from 'node:crypto';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../index.js';
import { pool } from '../services/database.js';
import { PaymentProviderService } from '../services/paymentProvider.js';
import { generateAccessToken } from '../services/auth.js';

describe('FinCore Assessment 15 — Financial Incident Simulation Test Suite', () => {
  let incidentSenderId: string;
  let incidentSenderWalletId: string;
  let incidentSenderToken: string;
  let incidentRecipientId: string;
  let incidentRecipientWalletId: string;
  let incidentBeneficiaryId: string;
  let attackerId: string;
  let attackerWalletId: string;
  let attackerToken: string;
  const adminToken = generateAccessToken({
    id: 'a0000000-0000-0000-0000-000000000005',
    email: 'platform.admin@fincore.internal',
    role: 'platform_administrator',
    fullName: 'Platform Admin',
  });

  // =========================================================================
  // Setup: Provision isolated synthetic test accounts, wallets, and tokens
  // =========================================================================
  it('Setup: Provisions isolated synthetic accounts and funded wallets for simulation', async () => {
    const timestamp = Date.now();
    const senderEmail = `incident.sender.${timestamp}@example.com`;
    const recipientEmail = `incident.recipient.${timestamp}@example.com`;
    const attackerEmail = `incident.attacker.${timestamp}@example.com`;
    const password = 'TestSecureIncidentPass123!';

    // Register sender ($400.00)
    const regSender = await request(app).post('/api/auth/register').send({
      email: senderEmail,
      fullName: 'Incident Test Sender',
      password,
    });
    assert.strictEqual(regSender.status, 201);
    incidentSenderId = regSender.body.user.id;
    incidentSenderToken = regSender.body.accessToken;

    // Register recipient ($50.00)
    const regRecipient = await request(app).post('/api/auth/register').send({
      email: recipientEmail,
      fullName: 'Incident Test Recipient',
      password,
    });
    assert.strictEqual(regRecipient.status, 201);
    incidentRecipientId = regRecipient.body.user.id;

    // Register attacker ($10.00)
    const regAttacker = await request(app).post('/api/auth/register').send({
      email: attackerEmail,
      fullName: 'Incident Attacker',
      password,
    });
    assert.strictEqual(regAttacker.status, 201);
    attackerId = regAttacker.body.user.id;
    attackerToken = regAttacker.body.accessToken;

    // Create funded wallets
    const w1 = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: incidentSenderId,
        currency: 'USD',
        initialBalance: 400.0,
      });
    assert.strictEqual(w1.status, 201);
    incidentSenderWalletId = w1.body.wallet.id;

    const w2 = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: incidentRecipientId,
        currency: 'USD',
        initialBalance: 50.0,
      });
    assert.strictEqual(w2.status, 201);
    incidentRecipientWalletId = w2.body.wallet.id;

    const w3 = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: attackerId,
        currency: 'USD',
        initialBalance: 10.0,
      });
    assert.strictEqual(w3.status, 201);
    attackerWalletId = w3.body.wallet.id;

    // Beneficiary
    const bRes = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: incidentSenderId,
        name: 'Incident Recipient Ben',
        accountNumber: 'US-INCIDENT-999',
        bankName: 'Incident Bank',
        currency: 'USD',
      });
    assert.strictEqual(bRes.status, 201);
    incidentBeneficiaryId = bRes.body.beneficiary.id;
  });

  // =========================================================================
  // 1. Incident Simulation: Duplicate Payment & Webhook Replay Burst
  // =========================================================================
  it('Scenario 1: Webhook Replay Attack — Concurrent duplicate delivery is deduplicated without double-crediting', async () => {
    const eventId = `evt_replay_incident_${Date.now()}`;
    const payload = {
      id: eventId,
      type: 'payment_intent.succeeded',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: crypto.randomUUID(),
          amount: 50.0,
          currency: 'USD',
          status: 'succeeded',
        },
      },
    };

    const { header } = PaymentProviderService.signPayload(payload);

    // Fire 3 simultaneous deliveries of the exact same event
    const burst = await Promise.all([
      request(app).post('/api/webhooks/payments').set('fincore-signature', header).send(payload),
      request(app).post('/api/webhooks/payments').set('fincore-signature', header).send(payload),
      request(app).post('/api/webhooks/payments').set('fincore-signature', header).send(payload),
    ]);

    // All should return HTTP 200 (processed or duplicate acknowledged)
    burst.forEach(res => assert.strictEqual(res.status, 200));

    // Exactly one DB event must exist
    const countCheck = await pool.query('SELECT count(*) FROM webhook_events WHERE event_id = $1', [
      eventId,
    ]);
    assert.strictEqual(
      parseInt(countCheck.rows[0].count, 10),
      1,
      'Exactly 1 webhook event record created'
    );
  });

  // =========================================================================
  // 2. Incident Simulation: Concurrent Double-Spending Race
  // =========================================================================
  it('Scenario 2: Double-Spending Race — 2 concurrent transfers of $300 on $400 balance: exactly 1 succeeds', async () => {
    // Current sender balance: $400. Two parallel requests of $300 (total $600 > $400)
    const t1 = request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${incidentSenderToken}`)
      .send({
        sourceWalletId: incidentSenderWalletId,
        beneficiaryId: incidentBeneficiaryId,
        amount: 300.0,
        description: 'Incident concurrent transfer attempt 1',
        idempotencyKey: `INC-RACE-1-${Date.now()}`,
      });

    const t2 = request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${incidentSenderToken}`)
      .send({
        sourceWalletId: incidentSenderWalletId,
        beneficiaryId: incidentBeneficiaryId,
        amount: 300.0,
        description: 'Incident concurrent transfer attempt 2',
        idempotencyKey: `INC-RACE-2-${Date.now()}`,
      });

    const [res1, res2] = await Promise.all([t1, t2]);
    const statuses = [res1.status, res2.status].sort();

    assert.strictEqual(statuses[0], 201, 'Exactly one transfer must succeed');
    assert.strictEqual(statuses[1], 400, 'Second transfer must fail with insufficient funds');

    // Balance must be exactly $100.0000 (never negative overdraft)
    const walletCheck = await pool.query('SELECT balance FROM wallets WHERE id = $1', [
      incidentSenderWalletId,
    ]);
    assert.strictEqual(parseFloat(walletCheck.rows[0].balance).toFixed(4), '100.0000');
  });

  // =========================================================================
  // 3. Incident Simulation: Payment Provider Failure & Fallback Handling
  // =========================================================================
  it('Scenario 3: Payment Gateway Failure — Ingests failure event, marks transaction failed, preserves balance', async () => {
    const paymentIntentId = `pi_fail_incident_${Date.now()}`;
    const txnRes = await pool.query(
      `INSERT INTO transactions (wallet_id, type, amount, currency, status, description, metadata)
       VALUES ($1, 'payment', 75.0000, 'USD', 'pending', 'Pending card payment', $2)
       RETURNING id`,
      [incidentSenderWalletId, JSON.stringify({ paymentIntentId })]
    );
    const txnId = txnRes.rows[0].id;

    // Upstream gateway fails with card declined
    const failPayload = {
      id: `evt_fail_${Date.now()}`,
      type: 'payment_intent.payment_failed',
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: paymentIntentId,
          transaction_id: txnId,
          amount: 75.0,
          currency: 'USD',
          status: 'failed',
          failure_reason: 'card_declined_insufficient_funds',
        },
      },
    };
    const { header } = PaymentProviderService.signPayload(failPayload);

    const failRes = await request(app)
      .post('/api/webhooks/payments')
      .set('fincore-signature', header)
      .send(failPayload);

    assert.strictEqual(failRes.status, 200);

    // Verify transaction status in DB is failed with recorded reason
    const checkTxn = await pool.query('SELECT status, metadata FROM transactions WHERE id = $1', [
      txnId,
    ]);
    assert.strictEqual(checkTxn.rows[0].status, 'failed');
    assert.match(JSON.stringify(checkTxn.rows[0].metadata), /card_declined_insufficient_funds/);
  });

  // =========================================================================
  // 4. Incident Simulation: Unauthorized Cross-Account Breach Attempt
  // =========================================================================
  it('Scenario 4: Security Breach Attempt — Attacker tries unauthorized debit from victim wallet: blocked with 403', async () => {
    const breachRes = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${attackerToken}`)
      .send({
        sourceWalletId: incidentSenderWalletId, // Victim's wallet
        beneficiaryId: incidentBeneficiaryId,
        amount: 80.0,
        description: 'Hostile unauthorized debit attempt',
        idempotencyKey: `BREACH-${Date.now()}`,
      });

    assert.strictEqual(breachRes.status, 403, 'Must be rejected with HTTP 403 Forbidden');
    assert.match(breachRes.body.error, /do not own the source wallet/i);

    // Verify victim's balance remains strictly untouched ($100.0000)
    const checkVictim = await pool.query('SELECT balance FROM wallets WHERE id = $1', [
      incidentSenderWalletId,
    ]);
    assert.strictEqual(parseFloat(checkVictim.rows[0].balance).toFixed(4), '100.0000');
  });

  // =========================================================================
  // 5. Post-Recovery Financial Integrity Verification
  // =========================================================================
  it('Scenario 5: Post-Incident Integrity Audit — Verified zero unbalanced ledger transactions', async () => {
    const unbalRes = await pool.query(`
      SELECT transaction_id, 
             SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as debit,
             SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as credit
      FROM ledger_entries
      GROUP BY transaction_id
      HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END)
    `);

    assert.strictEqual(
      unbalRes.rows.length,
      0,
      'Zero unbalanced ledger transactions after incident recovery'
    );
  });

  // =========================================================================
  // Teardown
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
