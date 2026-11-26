import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../index.js';
import { pool } from '../services/database.js';
import { generateAccessToken, generateConfirmationToken } from '../services/auth.js';

describe('FinCore Assessment 02 — Financial REST APIs Test Suite', () => {
  let testUserId: string;
  let testWalletId: string;
  let testBeneficiaryId: string;
  let testTransactionId: string;
  let testPaymentIntentId: string;
  let testDisputeId: string;

  const adminToken = generateAccessToken({
    id: 'a0000000-0000-0000-0000-000000000005',
    email: 'platform.admin@fincore.internal',
    role: 'platform_administrator',
    fullName: 'Platform Admin',
  });
  const confirmationToken = generateConfirmationToken('a0000000-0000-0000-0000-000000000005');

  // 1. Account Management APIs
  describe('1. Account APIs (/api/accounts)', () => {
    it('POST /api/accounts - successfully creates an account', async () => {
      const email = `test.user.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@example.com`;
      const phone = `+1555${Math.floor(1000000 + Math.random() * 9000000)}`;
      const res = await request(app)
        .post('/api/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email,
          fullName: 'Jane Developer',
          phone,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.account.email, email);
      assert.strictEqual(res.body.account.fullName, 'Jane Developer');
      assert.strictEqual(res.body.account.isVerified, false);
      assert.ok(res.body.account.id);
      testUserId = res.body.account.id;
    });

    it('POST /api/accounts - rejects duplicate email with 409 Conflict', async () => {
      const userRes = await pool.query('SELECT email FROM users LIMIT 1');
      const existingEmail = userRes.rows[0].email;

      const res = await request(app)
        .post('/api/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: existingEmail,
          fullName: 'Duplicate User',
        });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error, 'Conflict');
    });

    it('POST /api/accounts - validates malformed email with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/accounts')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          email: 'not-an-email',
          fullName: 'Bad Email',
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Validation Error');
    });

    it('GET /api/accounts - lists accounts with pagination and filtering', async () => {
      const res = await request(app)
        .get('/api/accounts?page=1&limit=5')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.accounts));
      assert.ok(res.body.pagination);
      assert.strictEqual(res.body.pagination.page, 1);
      assert.strictEqual(res.body.pagination.limit, 5);
      assert.ok(res.body.pagination.total >= 1);
    });

    it('GET /api/accounts/:id - retrieves account details with linked wallets', async () => {
      const res = await request(app)
        .get(`/api/accounts/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.account.id, testUserId);
      assert.ok(Array.isArray(res.body.account.wallets));
    });

    it('PATCH /api/accounts/:id - updates account profile fields', async () => {
      const res = await request(app)
        .patch(`/api/accounts/${testUserId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          fullName: 'Jane Updated',
          isVerified: true,
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.account.fullName, 'Jane Updated');
      assert.strictEqual(res.body.account.isVerified, true);
    });
  });

  // 2. Wallet Management APIs
  describe('2. Wallet APIs (/api/wallets)', () => {
    it('POST /api/wallets - creates wallet with initial balance', async () => {
      const res = await request(app)
        .post('/api/wallets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: testUserId,
          currency: 'USD',
          initialBalance: 5000.0,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.wallet.userId, testUserId);
      assert.strictEqual(res.body.wallet.currency, 'USD');
      assert.strictEqual(res.body.wallet.balance, 5000.0);
      assert.strictEqual(res.body.wallet.status, 'active');
      testWalletId = res.body.wallet.id;
    });

    it('GET /api/wallets/:id - retrieves wallet by ID', async () => {
      const res = await request(app)
        .get(`/api/wallets/${testWalletId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.wallet.id, testWalletId);
      assert.strictEqual(res.body.wallet.balance, 5000.0);
    });

    it('GET /api/wallets - lists wallets with filters and pagination', async () => {
      const res = await request(app)
        .get(`/api/wallets?userId=${testUserId}&currency=USD`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.wallets.length >= 1);
      assert.strictEqual(res.body.wallets[0].currency, 'USD');
      assert.ok(res.body.pagination);
    });

    it('PATCH /api/wallets/:id/status - freezes wallet successfully', async () => {
      const res = await request(app)
        .patch(`/api/wallets/${testWalletId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'frozen',
          reason: 'Compliance audit hold',
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.wallet.status, 'frozen');
      assert.strictEqual(res.body.audit.newStatus, 'frozen');

      // Unfreeze for subsequent tests
      await request(app)
        .patch(`/api/wallets/${testWalletId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'active',
          reason: 'Audit completed',
        });
    });

    it('POST /api/wallets - rejects creation for non-existent user with 404', async () => {
      const res = await request(app)
        .post('/api/wallets')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: '00000000-0000-0000-0000-000000000000',
          currency: 'USD',
          initialBalance: 100,
        });

      assert.strictEqual(res.status, 404);
      assert.strictEqual(res.body.error, 'User account not found');
    });
  });

  // 3. Beneficiary Management APIs
  describe('3. Beneficiary APIs (/api/beneficiaries)', () => {
    it('POST /api/beneficiaries - creates a new transfer beneficiary', async () => {
      const res = await request(app)
        .post('/api/beneficiaries')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          userId: testUserId,
          name: 'Apex Global Logistics',
          accountNumber: 'US9876543210',
          routingNumber: '021000021',
          bankName: 'JPMorgan Chase',
          currency: 'USD',
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.beneficiary.name, 'Apex Global Logistics');
      assert.strictEqual(res.body.beneficiary.currency, 'USD');
      assert.ok(res.body.beneficiary.id);
      testBeneficiaryId = res.body.beneficiary.id;
    });

    it('GET /api/beneficiaries - lists beneficiaries with pagination and search', async () => {
      const res = await request(app)
        .get('/api/beneficiaries?search=Apex')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.beneficiaries));
      assert.ok(res.body.beneficiaries.some((b: any) => b.id === testBeneficiaryId));
      assert.ok(res.body.pagination);
    });

    it('GET /api/beneficiaries/:id - retrieves a single beneficiary', async () => {
      const res = await request(app)
        .get(`/api/beneficiaries/${testBeneficiaryId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.beneficiary.id, testBeneficiaryId);
      assert.strictEqual(res.body.beneficiary.name, 'Apex Global Logistics');
    });

    it('PATCH /api/beneficiaries/:id - updates beneficiary details', async () => {
      const res = await request(app)
        .patch(`/api/beneficiaries/${testBeneficiaryId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          bankName: 'JPMorgan Chase & Co.',
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.beneficiary.bankName, 'JPMorgan Chase & Co.');
    });

    it('POST /api/beneficiaries - rejects invalid payload with 400', async () => {
      const res = await request(app)
        .post('/api/beneficiaries')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          name: 'A', // too short
          accountNumber: '12', // too short
          bankName: '',
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Validation Error');
    });
  });

  // 4. Transfer APIs & Double-Entry Invariance
  describe('4. Transfer APIs (/api/transactions/transfer)', () => {
    it('POST /api/transactions/transfer - executes atomic transfer with balanced double-entry ledger entries', async () => {
      const idempotencyKey = `test-transfer-${Date.now()}`;
      const res = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 250.0,
          description: 'Vendor payment Q4',
          idempotencyKey,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.transaction.amount, 250.0);
      assert.strictEqual(res.body.transaction.status, 'completed');
      assert.strictEqual(res.body.newBalance, 4750.0);
      testTransactionId = res.body.transaction.id;

      // Verify double-entry ledger entries in database
      const ledgerRes = await pool.query(
        'SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY entry_type ASC',
        [testTransactionId]
      );
      assert.strictEqual(ledgerRes.rows.length, 2);
      const creditEntry = ledgerRes.rows.find(r => r.entry_type === 'credit');
      const debitEntry = ledgerRes.rows.find(r => r.entry_type === 'debit');

      assert.ok(creditEntry);
      assert.ok(debitEntry);
      assert.strictEqual(parseFloat(creditEntry.amount), 250.0);
      assert.strictEqual(parseFloat(debitEntry.amount), 250.0);
      assert.strictEqual(debitEntry.wallet_id, testWalletId);
    });

    it('POST /api/transactions/transfer - duplicate submission returns 200 without second deduction', async () => {
      const idempotencyKey = `idemp-dup-${Date.now()}`;
      const payload = {
        sourceWalletId: testWalletId,
        beneficiaryId: testBeneficiaryId,
        amount: 100.0,
        description: 'Idempotency test transfer',
        idempotencyKey,
      };

      const res1 = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);
      assert.strictEqual(res1.status, 201);
      const balanceAfterFirst = res1.body.newBalance;

      // Duplicate submission
      const res2 = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send(payload);
      assert.strictEqual(res2.status, 200);
      assert.strictEqual(res2.body.duplicate, true);
      assert.strictEqual(res2.body.newBalance, balanceAfterFirst);
    });

    it('POST /api/transactions/transfer - rejects transfers from frozen wallets', async () => {
      // Freeze wallet
      await request(app)
        .patch(`/api/wallets/${testWalletId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'frozen' });

      const res = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 50.0,
          description: 'Should fail',
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('frozen'));

      // Unfreeze
      await request(app)
        .patch(`/api/wallets/${testWalletId}/status`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ status: 'active' });
    });

    it('POST /api/transactions/transfer - rejects insufficient balance with 400', async () => {
      const res = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 9999999.0,
          description: 'Overdraw attempt',
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('Insufficient'));
    });
  });

  // 5. Payment Intent APIs
  describe('5. Payment Intent APIs (/api/payments/intents)', () => {
    it('POST /api/payments/intents - creates payment intent with requires_confirmation', async () => {
      const idempotencyKey = `pi-${Date.now()}`;
      const res = await request(app)
        .post('/api/payments/intents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          walletId: testWalletId,
          amount: 150.0,
          currency: 'USD',
          description: 'E-commerce checkout intent',
          idempotencyKey,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.paymentIntent.status, 'requires_confirmation');
      assert.strictEqual(res.body.paymentIntent.amount, 150.0);
      assert.ok(res.body.paymentIntent.clientSecret);
      testPaymentIntentId = res.body.paymentIntent.id;
    });

    it('GET /api/payments/intents/:id - retrieves payment intent details', async () => {
      const res = await request(app)
        .get(`/api/payments/intents/${testPaymentIntentId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.paymentIntent.id, testPaymentIntentId);
      assert.strictEqual(res.body.paymentIntent.status, 'requires_confirmation');
    });

    it('POST /api/payments/intents/:id/confirm - confirms intent atomically', async () => {
      const res = await request(app)
        .post(`/api/payments/intents/${testPaymentIntentId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.paymentIntent.status, 'succeeded');
      assert.strictEqual(res.body.paymentIntent.amount, 150.0);

      // Verify double-entry ledger entries exist for payment
      const ledgerRes = await pool.query('SELECT * FROM ledger_entries WHERE transaction_id = $1', [
        testPaymentIntentId,
      ]);
      assert.strictEqual(ledgerRes.rows.length, 2);
    });

    it('POST /api/payments/intents/:id/confirm - replay of confirmed intent returns 200 duplicate', async () => {
      const res = await request(app)
        .post(`/api/payments/intents/${testPaymentIntentId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.duplicate, true);
    });

    it('POST /api/payments/intents/:id/cancel - cancels unconfirmed intent', async () => {
      const intentRes = await request(app)
        .post('/api/payments/intents')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          walletId: testWalletId,
          amount: 25.0,
          currency: 'USD',
          description: 'To be cancelled',
        });
      const intentId = intentRes.body.paymentIntent.id;

      const cancelRes = await request(app)
        .post(`/api/payments/intents/${intentId}/cancel`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(cancelRes.status, 200);
      assert.strictEqual(cancelRes.body.paymentIntent.status, 'cancelled');

      // Attempting to confirm cancelled intent is rejected with 422
      const confirmRes = await request(app)
        .post(`/api/payments/intents/${intentId}/confirm`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(confirmRes.status, 422);
    });
  });

  // 6. Refund APIs
  describe('6. Refund APIs (/api/transactions/:id/refund)', () => {
    it('POST /api/transactions/:id/refund - processes partial refund and credits customer', async () => {
      const walletBefore = await pool.query('SELECT balance FROM wallets WHERE id = $1', [
        testWalletId,
      ]);
      const initialBalance = parseFloat(walletBefore.rows[0].balance);

      const res = await request(app)
        .post(`/api/transactions/${testPaymentIntentId}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-action-confirmation', confirmationToken)
        .send({
          amount: 50.0,
          reason: 'Customer requested partial refund',
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.refund.amount, 50.0);
      assert.strictEqual(res.body.refund.originalTransactionId, testPaymentIntentId);
      assert.strictEqual(res.body.newBalance, initialBalance + 50.0);

      // Verify double-entry ledger entries for refund
      const ledgerRes = await pool.query('SELECT * FROM ledger_entries WHERE transaction_id = $1', [
        res.body.refund.id,
      ]);
      assert.strictEqual(ledgerRes.rows.length, 2);
      const creditEntry = ledgerRes.rows.find(r => r.entry_type === 'credit');
      const debitEntry = ledgerRes.rows.find(r => r.entry_type === 'debit');
      assert.strictEqual(creditEntry.wallet_id, testWalletId);
      assert.strictEqual(parseFloat(creditEntry.amount), 50.0);
      assert.strictEqual(parseFloat(debitEntry.amount), 50.0);
    });

    it('POST /api/transactions/:id/refund - rejects refund exceeding original amount with 400', async () => {
      const res = await request(app)
        .post(`/api/transactions/${testPaymentIntentId}/refund`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-action-confirmation', confirmationToken)
        .send({
          amount: 9999.0,
          reason: 'Excessive refund request',
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Refund Limit Exceeded');
    });

    it('POST /api/transactions/:id/refund - rejects refund on non-existent transaction with 404', async () => {
      const res = await request(app)
        .post('/api/transactions/00000000-0000-0000-0000-000000000000/refund')
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-action-confirmation', confirmationToken)
        .send({
          reason: 'Non-existent',
        });

      assert.strictEqual(res.status, 404);
    });
  });

  // 7. Transaction Reversal APIs
  describe('7. Reversal APIs (/api/transactions/:id/reversal)', () => {
    it('POST /api/transactions/:id/reversal - reverses transaction and restores balance', async () => {
      // Create a specific transfer to reverse
      const transferRes = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          sourceWalletId: testWalletId,
          beneficiaryId: testBeneficiaryId,
          amount: 75.0,
          description: 'Transfer to be reversed',
        });
      const txnToReverseId = transferRes.body.transaction.id;
      const balanceBeforeReversal = transferRes.body.newBalance;

      const reversalRes = await request(app)
        .post(`/api/transactions/${txnToReverseId}/reversal`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-action-confirmation', confirmationToken)
        .send({
          reason: 'Erroneous duplicate entry adjustment',
        });

      assert.strictEqual(reversalRes.status, 200);
      assert.strictEqual(reversalRes.body.transaction.status, 'cancelled');
      assert.strictEqual(reversalRes.body.transaction.reversed, true);
      assert.strictEqual(reversalRes.body.transaction.newBalance, balanceBeforeReversal + 75.0);

      // Verify double reversal is rejected with 409 Conflict
      const secondReversal = await request(app)
        .post(`/api/transactions/${txnToReverseId}/reversal`)
        .set('Authorization', `Bearer ${adminToken}`)
        .set('x-action-confirmation', confirmationToken)
        .send({
          reason: 'Second reversal attempt',
        });
      assert.strictEqual(secondReversal.status, 409);
      assert.strictEqual(secondReversal.body.error, 'Conflict');
    });
  });

  // 8. Dispute Management APIs
  describe('8. Dispute APIs (/api/disputes)', () => {
    it('POST /api/disputes - submits a dispute for a transaction', async () => {
      const res = await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          transactionId: testTransactionId,
          reason: 'Unauthorized debit',
          details: 'Customer did not recognize this transfer',
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.dispute.transactionId, testTransactionId);
      assert.strictEqual(res.body.dispute.status, 'pending_review');
      testDisputeId = res.body.dispute.id;
    });

    it('POST /api/disputes - rejects duplicate dispute for same transaction with 400', async () => {
      const res = await request(app)
        .post('/api/disputes')
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          transactionId: testTransactionId,
          reason: 'Duplicate dispute',
          details: 'Second dispute filing',
        });

      assert.strictEqual(res.status, 400);
      assert.ok(res.body.error.includes('already been submitted'));
    });

    it('GET /api/disputes/:id - retrieves dispute with transaction and ledger details', async () => {
      const res = await request(app)
        .get(`/api/disputes/${testDisputeId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.dispute.id, testDisputeId);
      assert.ok(res.body.dispute.transaction);
      assert.ok(Array.isArray(res.body.dispute.ledgerEntries));
    });

    it('PATCH /api/disputes/:id - updates dispute status with investigation notes', async () => {
      const res = await request(app)
        .patch(`/api/disputes/${testDisputeId}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({
          status: 'under_investigation',
          resolutionNotes: 'Evidence requested from issuing bank',
        });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.dispute.status, 'under_investigation');
      assert.strictEqual(res.body.dispute.resolution_notes, 'Evidence requested from issuing bank');
    });

    it('GET /api/disputes - lists disputes with status filter', async () => {
      const res = await request(app)
        .get('/api/disputes?status=under_investigation')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.disputes.some((d: any) => d.id === testDisputeId));
      assert.ok(res.body.pagination);
    });
  });

  // 9. Financial Statement APIs
  describe('9. Financial Statement APIs (/api/statements)', () => {
    it('GET /api/statements - generates statement in JSON format', async () => {
      const res = await request(app)
        .get(`/api/statements?walletId=${testWalletId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.statement);
      assert.strictEqual(res.body.statement.wallet.id, testWalletId);
      assert.ok(res.body.statement.summary.totalDebits >= 0);
      assert.ok(res.body.statement.summary.totalCredits >= 0);
      assert.ok(typeof res.body.statement.summary.netFlow === 'number');
      assert.ok(Array.isArray(res.body.statement.transactions));
    });

    it('GET /api/statements - generates statement in CSV export format', async () => {
      const res = await request(app)
        .get(`/api/statements?walletId=${testWalletId}&format=csv`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.headers['content-type'].includes('text/csv'));
      assert.ok(res.text.includes('Transaction ID,Date,Type,Amount,Currency,Status,Description'));
    });

    it('GET /api/statements/:walletId - generates statement via path parameter', async () => {
      const res = await request(app)
        .get(`/api/statements/${testWalletId}`)
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.statement.wallet.id, testWalletId);
    });

    it('GET /api/statements - rejects non-existent wallet with 404', async () => {
      const res = await request(app)
        .get('/api/statements?walletId=00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${adminToken}`);
      assert.strictEqual(res.status, 404);
    });
  });

  // Teardown
  after(async () => {
    // Delete created beneficiary to maintain state
    if (testBeneficiaryId) {
      await pool.query('DELETE FROM beneficiaries WHERE id = $1', [testBeneficiaryId]);
    }
  });
});
