import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../index.js';
import { pool } from '../services/database.js';
import { generateAccessToken, generateConfirmationToken } from '../services/auth.js';

describe('FinCore Assessment 03 — Double-Entry Ledger Database Integrity Test Suite', () => {
  let testUserId: string;
  let testWalletId: string;
  let testHoldId: string;
  let testTransactionId: string;
  const staffUserId = '00000000-0000-0000-0000-000000000003';
  const staffToken = generateAccessToken({
    id: staffUserId,
    email: 'finance3@fincore.internal',
    role: 'finance_administrator',
    fullName: 'Finance Staff 3',
  });
  const confirmationToken = generateConfirmationToken(staffUserId);

  // Setup: create test account and wallet
  it('Setup: creates test user and funded wallet', async () => {
    const email = `ledger.audit.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@example.com`;
    const userRes = await request(app)
      .post('/api/accounts')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        email,
        fullName: 'Ledger Auditor',
        phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
      });
    assert.strictEqual(userRes.status, 201);
    testUserId = userRes.body.account.id;

    const walletRes = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        userId: testUserId,
        currency: 'USD',
        initialBalance: 1000.0,
      });
    assert.strictEqual(walletRes.status, 201);
    testWalletId = walletRes.body.wallet.id;
  });

  // 1. Double-Entry Invariants and Historical Equilibrium
  describe('1. Double-Entry Balance Invariants & Reconciliation', () => {
    it('GET /api/ledger/reconciliation - verifies 100% mathematical equilibrium across entire ledger', async () => {
      const res = await request(app)
        .get('/api/ledger/reconciliation')
        .set('Authorization', `Bearer ${staffToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.reconciliation.balanced, true);
      assert.strictEqual(res.body.reconciliation.difference, 0);
      assert.strictEqual(res.body.reconciliation.unbalancedTransactionsCount, 0);
      assert.ok(res.body.reconciliation.totalDebits > 0);
      assert.strictEqual(res.body.reconciliation.totalDebits, res.body.reconciliation.totalCredits);
    });

    it('Database query verifies every historical and new transaction has equal debits and credits', async () => {
      const queryRes = await pool.query(`
        SELECT transaction_id, 
               SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debit,
               SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credit
        FROM ledger_entries
        GROUP BY transaction_id
        HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END)
      `);
      assert.strictEqual(queryRes.rows.length, 0);
    });
  });

  // 2. Strict Immutability Trigger Enforcement
  describe('2. Ledger Immutability & Append-Only Enforcement', () => {
    it('Database trigger blocks UPDATE on ledger_entries with strict immutability exception', async () => {
      const anyEntry = await pool.query('SELECT id FROM ledger_entries LIMIT 1');
      assert.ok(anyEntry.rows.length > 0);
      const entryId = anyEntry.rows[0].id;

      let threw = false;
      try {
        await pool.query('UPDATE ledger_entries SET amount = 9999.00 WHERE id = $1', [entryId]);
      } catch (err: any) {
        threw = true;
        assert.ok(
          err.message.includes('strictly immutable') || err.message.includes('append-only')
        );
      }
      assert.strictEqual(threw, true);
    });

    it('Database trigger blocks DELETE on ledger_entries with strict immutability exception', async () => {
      const anyEntry = await pool.query('SELECT id FROM ledger_entries LIMIT 1');
      assert.ok(anyEntry.rows.length > 0);
      const entryId = anyEntry.rows[0].id;

      let threw = false;
      try {
        await pool.query('DELETE FROM ledger_entries WHERE id = $1', [entryId]);
      } catch (err: any) {
        threw = true;
        assert.ok(
          err.message.includes('strictly immutable') || err.message.includes('append-only')
        );
      }
      assert.strictEqual(threw, true);
    });
  });

  // 3. Wallet Holds & Available Balance Tracking
  describe('3. Wallet Holds & Available Balance Tracking', () => {
    it('POST /api/holds - places hold, increments held_balance and reduces available_balance', async () => {
      const res = await request(app)
        .post('/api/holds')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          walletId: testWalletId,
          amount: 200.0,
          currency: 'USD',
          reason: 'Hotel reservation authorization deposit',
          expiresInMinutes: 60,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.hold.amount, 200.0);
      assert.strictEqual(res.body.hold.status, 'active');
      assert.strictEqual(res.body.wallet.totalBalance, 1000.0);
      assert.strictEqual(res.body.wallet.heldBalance, 200.0);
      assert.strictEqual(res.body.wallet.availableBalance, 800.0);
      testHoldId = res.body.hold.id;
    });

    it('POST /api/holds - rejects hold exceeding available balance with 400', async () => {
      const res = await request(app)
        .post('/api/holds')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          walletId: testWalletId,
          amount: 850.0, // only 800 is available
          currency: 'USD',
          reason: 'Excessive hold attempt',
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Insufficient Available Balance');
    });

    it('GET /api/holds - lists holds filtered by wallet and status', async () => {
      const res = await request(app)
        .get(`/api/holds?walletId=${testWalletId}&status=active`)
        .set('Authorization', `Bearer ${staffToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(res.body.holds.some((h: any) => h.id === testHoldId));
      assert.ok(res.body.pagination);
    });

    it('POST /api/holds/:id/release - releases hold and restores available balance', async () => {
      const res = await request(app)
        .post(`/api/holds/${testHoldId}/release`)
        .set('Authorization', `Bearer ${staffToken}`);
      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.hold.status, 'released');
      assert.strictEqual(res.body.wallet.totalBalance, 1000.0);
      assert.strictEqual(res.body.wallet.heldBalance, 0);
      assert.strictEqual(res.body.wallet.availableBalance, 1000.0);

      // Re-releasing a released hold is rejected with 422
      const doubleRelease = await request(app)
        .post(`/api/holds/${testHoldId}/release`)
        .set('Authorization', `Bearer ${staffToken}`);
      assert.strictEqual(doubleRelease.status, 422);
    });

    it('POST /api/holds/:id/capture - captures hold into settled transaction with balanced ledger entries', async () => {
      // Place a new hold to capture
      const holdRes = await request(app)
        .post('/api/holds')
        .set('Authorization', `Bearer ${staffToken}`)
        .send({
          walletId: testWalletId,
          amount: 350.0,
          currency: 'USD',
          reason: 'Merchant authorization capture test',
        });
      assert.strictEqual(holdRes.status, 201);
      const holdToCaptureId = holdRes.body.hold.id;

      const captureRes = await request(app)
        .post(`/api/holds/${holdToCaptureId}/capture`)
        .set('Authorization', `Bearer ${staffToken}`);
      assert.strictEqual(captureRes.status, 200);
      assert.strictEqual(captureRes.body.hold.status, 'settled');
      assert.strictEqual(captureRes.body.wallet.balance, 650.0);
      assert.strictEqual(captureRes.body.wallet.heldBalance, 0);
      assert.strictEqual(captureRes.body.wallet.availableBalance, 650.0);
      testTransactionId = captureRes.body.transaction.id;

      // Verify matching debit and credit entries in ledger_entries
      const ledgerRes = await pool.query(
        'SELECT * FROM ledger_entries WHERE transaction_id = $1 ORDER BY entry_type ASC',
        [testTransactionId]
      );
      assert.strictEqual(ledgerRes.rows.length, 2);
      const credit = ledgerRes.rows.find(r => r.entry_type === 'credit');
      const debit = ledgerRes.rows.find(r => r.entry_type === 'debit');
      assert.strictEqual(parseFloat(credit.amount), 350.0);
      assert.strictEqual(parseFloat(debit.amount), 350.0);
      assert.strictEqual(debit.wallet_id, testWalletId);
    });
  });

  // 4. Multi-Entity Clearing & Settlements Schema
  describe('4. Multi-Entity Settlements & Clearing', () => {
    it('POST /api/settlements - records clearing institution settlement batch', async () => {
      const creditEntryRes = await pool.query(
        "SELECT wallet_id FROM ledger_entries WHERE transaction_id = $1 AND entry_type = 'credit'",
        [testTransactionId]
      );
      const destWalletId = creditEntryRes.rows[0].wallet_id;

      const res = await request(app)
        .post('/api/settlements')
        .set('Authorization', `Bearer ${staffToken}`)
        .set('x-action-confirmation', confirmationToken)
        .send({
          transactionId: testTransactionId,
          sourceWalletId: testWalletId,
          destinationWalletId: destWalletId,
          amount: 350.0,
          currency: 'USD',
          clearingInstitution: 'Federal Reserve ACH Interbank',
          referenceId: `FED-ACH-${Date.now()}`,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.settlement.transactionId, testTransactionId);
      assert.strictEqual(res.body.settlement.amount, 350.0);
      assert.strictEqual(res.body.settlement.status, 'settled');
      assert.strictEqual(res.body.settlement.clearingInstitution, 'Federal Reserve ACH Interbank');
    });

    it('GET /api/settlements - retrieves settlement batches with pagination', async () => {
      const res = await request(app)
        .get('/api/settlements?status=settled')
        .set('Authorization', `Bearer ${staffToken}`);
      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.settlements));
      assert.ok(res.body.settlements.length >= 1);
      assert.ok(res.body.pagination);
    });
  });

  // 5. Database Constraints & Precision
  describe('5. Database Constraints & Decimal Precision', () => {
    it('Database constraint enforces wallets.balance >= held_balance', async () => {
      let failed = false;
      try {
        await pool.query('UPDATE wallets SET held_balance = 999999.00 WHERE id = $1', [
          testWalletId,
        ]);
      } catch (err: any) {
        failed = true;
        assert.ok(err.message.includes('wallets_balance_exceeds_held'));
      }
      assert.strictEqual(failed, true);
    });

    it('Financial audit log table records immutable audit events', async () => {
      const auditRes = await pool.query(
        'SELECT * FROM financial_audit_logs ORDER BY created_at DESC LIMIT 5'
      );
      assert.ok(auditRes.rows.length >= 1);
      assert.ok(auditRes.rows[0].entity_type);
      assert.ok(auditRes.rows[0].action);
      assert.ok(auditRes.rows[0].created_at);
    });
  });

  // Teardown
  after(async () => {
    // Release any active holds to keep database clean
    await pool.query(
      "UPDATE holds SET status = 'released' WHERE wallet_id = $1 AND status = 'active'",
      [testWalletId]
    );
  });
});
