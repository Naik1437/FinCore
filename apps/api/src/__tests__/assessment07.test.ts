import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../index.js';
import { pool } from '../services/database.js';
import { generateAccessToken } from '../services/auth.js';

describe('FinCore Assessment 07 — Transfer Consistency Engine Test Suite', () => {
  let testUserId: string;
  let testWalletId: string;
  let testBeneficiaryId: string;
  const adminToken = generateAccessToken({
    id: 'a0000000-0000-0000-0000-000000000005',
    email: 'platform.admin@fincore.internal',
    role: 'platform_administrator',
    fullName: 'Platform Admin',
  });

  // Setup: create test account, wallet and beneficiary
  it('Setup: provisions user, funded wallet and beneficiary', async () => {
    const email = `consistency.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@example.com`;
    const userRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        email,
        fullName: 'Consistency Engine Auditor',
        phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      });
    assert.strictEqual(userRes.status, 201);
    testUserId = userRes.body.account.id;

    // Create wallet with $100.00
    const walletRes = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: testUserId,
        currency: 'USD',
        initialBalance: 100.0,
      });
    assert.strictEqual(walletRes.status, 201);
    testWalletId = walletRes.body.wallet.id;

    // Create beneficiary
    const benRes = await request(app)
      .post('/api/beneficiaries')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: testUserId,
        name: 'Alice Recipient',
        accountNumber: 'US1234567890123456',
        bankName: 'FinCore Test Bank',
        currency: 'USD',
      });
    assert.strictEqual(benRes.status, 201);
    testBeneficiaryId = benRes.body.beneficiary.id;
  });

  // ===========================================================================
  // 1. Race-Condition & Double-Spending Prevention
  // ===========================================================================
  describe('1. Concurrency Control & Double-Spending Prevention', () => {
    it('Concurrent transfers exceeding balance: exactly one succeeds and one fails with 400', async () => {
      // Wallet has $100.00. Fire two concurrent transfers of $60.00 each ($120.00 total)
      const t1 = request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 60.0,
          description: 'Parallel transfer attempt 1',
          idempotencyKey: `CONCUR-SPEND-1-${Date.now()}`,
        });

      const t2 = request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 60.0,
          description: 'Parallel transfer attempt 2',
          idempotencyKey: `CONCUR-SPEND-2-${Date.now()}`,
        });

      const [res1, res2] = await Promise.all([t1, t2]);
      const statuses = [res1.status, res2.status].sort();

      // Exactly one succeeds (201) and one fails due to insufficient funds (400)
      assert.deepStrictEqual(statuses, [201, 400]);

      const failedRes = res1.status === 400 ? res1 : res2;
      assert.match(failedRes.body.error, /Insufficient simulated funds/);

      // Verify wallet balance is strictly $40.00 (100 - 60), zero overdraft
      const walletRes = await request(app)
        .get(`/api/wallets/${testWalletId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(walletRes.status, 200);
      assert.strictEqual(parseFloat(walletRes.body.wallet.balance), 40.0);
    });
  });

  // ===========================================================================
  // 2. Concurrent Idempotency & Duplicate Request Protection
  // ===========================================================================
  describe('2. Concurrent Idempotency & Duplicate Request Protection', () => {
    it('Multiple concurrent requests with identical idempotency key deduct funds only once', async () => {
      const idempotencyKey = `IDEMP-BURST-${Date.now()}-${Math.random()}`;

      // Balance is $40.00. Fire 3 concurrent requests with IDENTICAL idempotency key for $10.00
      const requests = Array.from({ length: 3 }).map(() =>
        request(app)
          .post('/api/transactions/transfer')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            sourceWalletId: testWalletId,
            beneficiaryId: testBeneficiaryId,
            amount: 10.0,
            description: 'Idempotent burst transfer',
            idempotencyKey,
          })
      );

      const responses = await Promise.all(requests);

      // All responses should be successful (200 or 201) or 409 if in-flight lock hit
      for (const res of responses) {
        assert.ok([200, 201, 409].includes(res.status));
      }

      // Check balance is exactly $30.00 ($40 - $10), funds deducted strictly once!
      const walletRes = await request(app)
        .get(`/api/wallets/${testWalletId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(walletRes.status, 200);
      assert.strictEqual(parseFloat(walletRes.body.wallet.balance), 30.0);

      // Verify transactions table has exactly 1 record for this idempotency key
      const countRes = await pool.query(
        'SELECT COUNT(*) as count FROM transactions WHERE idempotency_key = $1',
        [idempotencyKey]
      );
      assert.strictEqual(parseInt(countRes.rows[0].count, 10), 1);
    });
  });

  // ===========================================================================
  // 3. Available Balance & Hold Consistency
  // ===========================================================================
  describe('3. Available Balance Tracking & Wallet Hold Consistency', () => {
    let activeHoldId: string;

    it('Active hold reduces available balance and blocks overdraw transfers', async () => {
      // Wallet balance is $30.00. Place a hold of $25.00
      const holdRes = await request(app)
        .post('/api/holds')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          walletId: testWalletId,
          amount: 25.0,
          currency: 'USD',
          reason: 'Hotel reservation hold',
        });
      assert.strictEqual(holdRes.status, 201);
      activeHoldId = holdRes.body.hold.id;

      // Available balance is now $5.00 ($30.00 - $25.00). Attempt a transfer of $10.00 -> must fail
      const overdrawRes = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 10.0,
          description: 'Should fail due to active hold',
        });
      assert.strictEqual(overdrawRes.status, 400);
      assert.match(overdrawRes.body.error, /Insufficient simulated funds/);

      // Transfer of $4.00 within available balance ($5.00) -> must succeed
      const allowedRes = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 4.0,
          description: 'Allowed transfer within available balance',
        });
      assert.strictEqual(allowedRes.status, 201);

      // Release hold
      const releaseRes = await request(app)
        .post(`/api/holds/${activeHoldId}/release`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          reason: 'Reservation completed',
        });
      assert.strictEqual(releaseRes.status, 200);

      // Wallet balance should now be $26.00 ($30 - $4), held balance $0.00
      const walletRes = await request(app)
        .get(`/api/wallets/${testWalletId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(parseFloat(walletRes.body.wallet.balance), 26.0);
      const heldAmt = parseFloat(
        walletRes.body.wallet.held_balance ?? walletRes.body.wallet.heldBalance ?? 0
      );
      assert.strictEqual(heldAmt, 0.0);
    });
  });

  // ===========================================================================
  // 4. Hold-Gated Transfer with Risk Policy Rejection
  // ===========================================================================
  describe('4. Hold-Gated Transfer with Risk Analytics Integration', () => {
    it('Extreme transfer triggers risk rejection, auto-releases hold, preserves balance', async () => {
      // Create a high-value wallet
      const highWalletRes = await request(app)
        .post('/api/wallets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: testUserId,
          currency: 'USD',
          initialBalance: 100000.0,
        });
      assert.strictEqual(highWalletRes.status, 201);
      const highWalletId = highWalletRes.body.wallet.id;

      // Attempt $60,000 transfer through risk gate -> should be rejected by automated risk policy
      const res = await request(app)
        .post('/api/transactions/transfer-with-risk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: highWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 60000.0,
          description: 'High value wire attempt',
        });

      assert.strictEqual(res.status, 422);
      assert.match(res.body.error, /Transfer rejected by automated risk policy/);
      assert.strictEqual(res.body.riskDecision, 'REJECT');
      assert.ok(res.body.riskScore >= 90);
      assert.ok(res.body.disclaimer);

      // Verify source wallet balance was NOT deducted and held balance is $0.00
      const walletRes = await request(app)
        .get(`/api/wallets/${highWalletId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(parseFloat(walletRes.body.wallet.balance), 100000.0);
      assert.strictEqual(parseFloat(walletRes.body.wallet.held_balance), 0.0);

      // Verify the created hold was marked as 'released'
      if (res.body.holdId) {
        const holdRes = await request(app)
          .get(`/api/holds/${res.body.holdId}`)
          .set('Authorization', `Bearer ${adminToken}`);
        assert.strictEqual(holdRes.body.hold.status, 'released');
      }
    });

    it('Normal transfer clears risk gate, settles hold, updates balance and ledger', async () => {
      const res = await request(app)
        .post('/api/transactions/transfer-with-risk')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 5.0,
          description: 'Standard risk-cleared transfer',
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.riskDecision, 'APPROVE');
      assert.ok(res.body.holdId);
      assert.strictEqual(res.body.transaction.status, 'completed');

      // Verify hold was settled
      const holdRes = await request(app)
        .get(`/api/holds/${res.body.holdId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(holdRes.body.hold.status, 'settled');

      // Verify double-entry ledger entries exist and are balanced
      const ledgerRes = await pool.query(
        'SELECT entry_type, amount FROM ledger_entries WHERE transaction_id = $1',
        [res.body.transaction.id]
      );
      assert.strictEqual(ledgerRes.rows.length, 2);
      const debit = ledgerRes.rows.find((r: any) => r.entry_type === 'debit');
      const credit = ledgerRes.rows.find((r: any) => r.entry_type === 'credit');
      assert.strictEqual(parseFloat(debit.amount), 5.0);
      assert.strictEqual(parseFloat(credit.amount), 5.0);
    });
  });

  // ===========================================================================
  // 5. Reliable Asynchronous Queue & Dead-Letter Queue (DLQ)
  // ===========================================================================
  describe('5. Reliable Asynchronous Queue & Dead-Letter Queue (DLQ)', () => {
    let queuedJobId: string;
    let dlqRecordId: string;

    it('POST /api/transactions/queue/enqueue - enqueues async transfer job', async () => {
      const res = await request(app)
        .post('/api/transactions/queue/enqueue')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 2.0,
          description: 'Async payroll transfer job',
          maxRetries: 3,
        });

      assert.strictEqual(res.status, 202);
      assert.ok(res.body.job.id);
      assert.strictEqual(res.body.job.status, 'pending');
      queuedJobId = res.body.job.id;
    });

    it('POST /api/transactions/queue/process - retries failures up to maxRetries then moves to DLQ', async () => {
      // Attempt 1: fails
      const p1 = await request(app)
        .post('/api/transactions/queue/process')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          jobId: queuedJobId,
          forceFailure: true,
          failureReason: 'Clearing network timeout 1',
        });
      assert.strictEqual(p1.body.status, 'failed');
      assert.strictEqual(p1.body.job.attempts, 1);

      // Attempt 2: fails
      const p2 = await request(app)
        .post('/api/transactions/queue/process')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          jobId: queuedJobId,
          forceFailure: true,
          failureReason: 'Clearing network timeout 2',
        });
      assert.strictEqual(p2.body.status, 'failed');
      assert.strictEqual(p2.body.job.attempts, 2);

      // Attempt 3 (maxRetries reached): transitions to 'dead_letter'
      const p3 = await request(app)
        .post('/api/transactions/queue/process')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          jobId: queuedJobId,
          forceFailure: true,
          failureReason: 'Clearing network timeout 3 (final attempt)',
        });
      assert.strictEqual(p3.body.status, 'dead_letter');
      assert.strictEqual(p3.body.job.attempts, 3);
    });

    it('GET /api/transactions/queue/dlq - queries DLQ and retrieves dead letter job', async () => {
      const res = await request(app)
        .get('/api/transactions/queue/dlq')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.count >= 1);
      const dlqItem = res.body.deadLetters.find((d: any) => d.job_id === queuedJobId);
      assert.ok(dlqItem);
      assert.strictEqual(dlqItem.attempts, 3);
      assert.match(dlqItem.failure_reason, /final attempt/);
      dlqRecordId = dlqItem.id;
    });

    it('POST /api/transactions/queue/dlq/:id/retry - replays dead letter job to completion', async () => {
      const res = await request(app)
        .post(`/api/transactions/queue/dlq/${dlqRecordId}/retry`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.result.status, 'completed');
      assert.ok(res.body.result.job.transaction_id);

      // Verify DLQ item marked as resolved
      const checkRes = await pool.query('SELECT resolved FROM dead_letter_queue WHERE id = $1', [
        dlqRecordId,
      ]);
      assert.strictEqual(checkRes.rows[0].resolved, true);
    });
  });

  // ===========================================================================
  // 6. Transaction Rollback & Failure Recovery
  // ===========================================================================
  describe('6. Transaction Rollback & Failure Recovery', () => {
    it('Currency mismatch or invalid input aborts cleanly with zero balance impact', async () => {
      const beforeWalletRes = await request(app)
        .get(`/api/wallets/${testWalletId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      const beforeBalance = parseFloat(beforeWalletRes.body.wallet.balance);

      // Create an EUR beneficiary to trigger currency mismatch
      const eurBenRes = await request(app)
        .post('/api/beneficiaries')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: testUserId,
          name: 'Euro Beneficiary',
          accountNumber: 'FR7630006000011234567890189',
          bankName: 'Eurobank Paris',
          currency: 'EUR',
        });
      assert.strictEqual(eurBenRes.status, 201);

      // Attempt USD wallet to EUR beneficiary transfer
      const mismatchRes = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: eurBenRes.body.beneficiary.id,
          amount: 10.0,
          description: 'Currency mismatch test',
        });
      assert.strictEqual(mismatchRes.status, 400);
      assert.match(mismatchRes.body.error, /Currency mismatch/);

      // Verify wallet balance is completely unchanged
      const afterWalletRes = await request(app)
        .get(`/api/wallets/${testWalletId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(parseFloat(afterWalletRes.body.wallet.balance), beforeBalance);

      // Verify zero unbalanced or orphaned ledger entries created
      const unbalRes = await pool.query(`
        SELECT transaction_id 
        FROM ledger_entries 
        GROUP BY transaction_id 
        HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END)
      `);
      assert.strictEqual(unbalRes.rows.length, 0);
    });
  });

  after(async () => {
    // Teardown connections so test process exits cleanly
    try {
      await pool.end();
    } catch (_err) {}
    try {
      const { disconnectRedis } = await import('../services/redis.js');
      await disconnectRedis();
    } catch (_err) {}
  });
});
