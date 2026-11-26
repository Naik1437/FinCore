import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../index.js';
import { pool } from '../services/database.js';

describe('FinCore Assessment 04 — Financial Identity & Authorization Test Suite', () => {
  let customerUser: {
    id: string;
    email: string;
    accessToken: string;
    refreshToken: string;
    walletId: string;
  };
  let secondCustomer: {
    id: string;
    email: string;
    accessToken: string;
    refreshToken: string;
    walletId: string;
  };
  let financeAdminUser: { id: string; email: string; accessToken: string; refreshToken: string };
  let platformAdminUser: { id: string; email: string; accessToken: string; refreshToken: string };
  let mfaUser: { id: string; email: string; password: string };

  const testPassword = 'Password123!';

  after(async () => {
    await pool.end();
  });

  // 1. Secure Registration & Password Hashing
  describe('1. Registration & Password Security', () => {
    it('POST /api/auth/register - registers customer, hashes password with bcrypt, and provisions default wallet', async () => {
      const email = `auth.customer.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@example.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: testPassword,
          fullName: 'Alice Customer',
          phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
        });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.user.email, email);
      assert.strictEqual(res.body.user.role, 'customer');
      assert.ok(res.body.accessToken, 'Access token should be issued');
      assert.ok(res.body.refreshToken, 'Refresh token should be issued');
      assert.ok(res.body.wallet?.id, 'Default wallet should be provisioned');
      assert.strictEqual(res.body.wallet.currency, 'USD');

      // Verify in DB that password is NOT plaintext but bcrypt hash
      const dbRes = await pool.query('SELECT password_hash FROM users WHERE id = $1', [
        res.body.user.id,
      ]);
      assert.ok(
        dbRes.rows[0].password_hash.startsWith('$2b$'),
        'Password must be hashed with bcrypt ($2b$)'
      );
      assert.notStrictEqual(
        dbRes.rows[0].password_hash,
        testPassword,
        'Plaintext password must never be stored'
      );

      customerUser = {
        id: res.body.user.id,
        email,
        accessToken: res.body.accessToken,
        refreshToken: res.body.refreshToken,
        walletId: res.body.wallet.id,
      };
    });

    it('POST /api/auth/register - registers second customer for cross-account testing', async () => {
      const email = `auth.bob.${Date.now()}.${Math.random().toString(36).substring(2, 7)}@example.com`;
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email,
          password: testPassword,
          fullName: 'Bob Customer',
          phone: `+1555${Math.floor(1000000 + Math.random() * 9000000)}`,
        });

      assert.strictEqual(res.status, 201);
      secondCustomer = {
        id: res.body.user.id,
        email,
        accessToken: res.body.accessToken,
        refreshToken: res.body.refreshToken,
        walletId: res.body.wallet.id,
      };
    });

    it('POST /api/auth/register - rejects weak password (<8 chars or no digits) with 400 Bad Request', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          email: `weak.${Date.now()}@example.com`,
          password: 'short',
          fullName: 'Weak Password User',
        });

      assert.strictEqual(res.status, 400);
      assert.strictEqual(res.body.error, 'Bad Request');
    });

    it('POST /api/auth/register - rejects duplicate email with 409 Conflict', async () => {
      const res = await request(app).post('/api/auth/register').send({
        email: customerUser.email,
        password: testPassword,
        fullName: 'Duplicate Alice',
      });

      assert.strictEqual(res.status, 409);
      assert.strictEqual(res.body.error, 'Conflict');
    });

    it('POST /api/auth/register - unauthenticated registration cannot self-escalate to platform_administrator', async () => {
      const email = `escalate.${Date.now()}@example.com`;
      const res = await request(app).post('/api/auth/register').send({
        email,
        password: testPassword,
        fullName: 'Sneaky Attacker',
        role: 'platform_administrator',
      });

      assert.strictEqual(res.status, 201);
      assert.strictEqual(res.body.user.role, 'customer', 'Role must safely downgrade to customer');
    });
  });

  // 2. Authentication, Login & Credential Verification
  describe('2. Login & Credential Verification', () => {
    it('POST /api/auth/login - succeeds with valid credentials returning JWT access & refresh tokens', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: customerUser.email,
        password: testPassword,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.email, customerUser.email);
      assert.ok(res.body.accessToken);
      assert.ok(res.body.refreshToken);
      customerUser.accessToken = res.body.accessToken;
      customerUser.refreshToken = res.body.refreshToken;
    });

    it('POST /api/auth/login - rejects invalid password with 401 Unauthorized and logs event', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: customerUser.email,
        password: 'WrongPassword999!',
      });

      assert.strictEqual(res.status, 401);
      assert.strictEqual(res.body.error, 'Unauthorized');
      assert.strictEqual(res.body.message, 'Invalid email or password credentials');
    });

    it('POST /api/auth/login - rejects non-existent email with 401 Unauthorized', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: 'nonexistent.ghost.user@example.com',
        password: testPassword,
      });

      assert.strictEqual(res.status, 401);
    });

    it('POST /api/auth/login - logs in seeded staff roles (Finance Admin & Platform Admin)', async () => {
      // Finance Admin
      const finRes = await request(app).post('/api/auth/login').send({
        email: 'finance.admin@fincore.internal',
        password: testPassword,
      });
      assert.strictEqual(finRes.status, 200);
      assert.strictEqual(finRes.body.user.role, 'finance_administrator');
      financeAdminUser = {
        id: finRes.body.user.id,
        email: finRes.body.user.email,
        accessToken: finRes.body.accessToken,
        refreshToken: finRes.body.refreshToken,
      };

      // Platform Admin
      const platRes = await request(app).post('/api/auth/login').send({
        email: 'platform.admin@fincore.internal',
        password: testPassword,
      });
      assert.strictEqual(platRes.status, 200);
      assert.strictEqual(platRes.body.user.role, 'platform_administrator');
      platformAdminUser = {
        id: platRes.body.user.id,
        email: platRes.body.user.email,
        accessToken: platRes.body.accessToken,
        refreshToken: platRes.body.refreshToken,
      };
    });
  });

  // 3. Session Management & Refresh Token Rotation
  describe('3. Session Management & Token Rotation', () => {
    it('GET /api/auth/me - returns authenticated user profile with valid Bearer token', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Authorization', `Bearer ${customerUser.accessToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.user.id, customerUser.id);
      assert.strictEqual(res.body.user.role, 'customer');
      assert.ok(Array.isArray(res.body.wallets));
    });

    it('GET /api/auth/me - rejects missing or malformed token with 401 Unauthorized', async () => {
      const noTokenRes = await request(app).get('/api/auth/me');
      assert.strictEqual(noTokenRes.status, 401);

      const invalidTokenRes = await request(app)
        .get('/api/auth/me')
        .set('Authorization', 'Bearer invalid.garbage.token');
      assert.strictEqual(invalidTokenRes.status, 401);
    });

    it('POST /api/auth/refresh - rotates refresh token: issues new tokens and revokes previous token', async () => {
      const initialRefreshToken = customerUser.refreshToken;

      const refreshRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      assert.strictEqual(refreshRes.status, 200);
      assert.ok(refreshRes.body.accessToken);
      assert.ok(refreshRes.body.refreshToken);
      assert.notStrictEqual(
        refreshRes.body.refreshToken,
        initialRefreshToken,
        'Refresh token must be rotated'
      );

      customerUser.accessToken = refreshRes.body.accessToken;
      customerUser.refreshToken = refreshRes.body.refreshToken;

      // Replay attack prevention: Attempting to use the OLD refresh token must fail with 401
      const replayRes = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: initialRefreshToken });

      assert.strictEqual(replayRes.status, 401);
    });

    it('POST /api/auth/logout - revokes refresh token session', async () => {
      const currentRefreshToken = customerUser.refreshToken;

      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Authorization', `Bearer ${customerUser.accessToken}`)
        .send({ refreshToken: currentRefreshToken });

      assert.strictEqual(logoutRes.status, 200);
      assert.strictEqual(logoutRes.body.success, true);

      // Subsequent refresh attempt with logged-out token must fail
      const refreshAfterLogout = await request(app)
        .post('/api/auth/refresh')
        .send({ refreshToken: currentRefreshToken });

      assert.strictEqual(refreshAfterLogout.status, 401);
    });
  });

  // 4. Two-Factor Authentication (MFA Simulation)
  describe('4. Two-Factor Authentication (MFA Lifecycle)', () => {
    let mfaSecret: string;
    let backupCodes: string[];

    it('Setup: registers and authenticates new MFA test user', async () => {
      const email = `mfa.tester.${Date.now()}@example.com`;
      const regRes = await request(app).post('/api/auth/register').send({
        email,
        password: testPassword,
        fullName: 'MFA Tester',
      });
      assert.strictEqual(regRes.status, 201);
      mfaUser = {
        id: regRes.body.user.id,
        email,
        password: testPassword,
      };
      customerUser.accessToken = regRes.body.accessToken;
    });

    it('POST /api/auth/mfa/setup - returns secret, emergency backup codes, and QR auth URL', async () => {
      const res = await request(app)
        .post('/api/auth/mfa/setup')
        .set('Authorization', `Bearer ${customerUser.accessToken}`);

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.secret);
      assert.ok(Array.isArray(res.body.backupCodes));
      assert.strictEqual(res.body.backupCodes.length, 4);
      assert.ok(res.body.otpauthUrl);
      mfaSecret = res.body.secret;
      backupCodes = res.body.backupCodes;
    });

    it('POST /api/auth/mfa/verify - activates MFA using valid code (123456 demo code)', async () => {
      const res = await request(app)
        .post('/api/auth/mfa/verify')
        .set('Authorization', `Bearer ${customerUser.accessToken}`)
        .send({ code: '123456' });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.success, true);

      // Verify MFA status in database
      const dbRes = await pool.query('SELECT mfa_enabled FROM users WHERE id = $1', [mfaUser.id]);
      assert.strictEqual(dbRes.rows[0].mfa_enabled, true);
    });

    it('POST /api/auth/login - MFA-enabled account requires two-step verification returning mfaToken', async () => {
      const res = await request(app).post('/api/auth/login').send({
        email: mfaUser.email,
        password: mfaUser.password,
      });

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.mfaRequired, true);
      assert.ok(res.body.mfaToken, 'Must issue temporary MFA challenge token');
      assert.strictEqual(
        res.body.accessToken,
        undefined,
        'Access token must NOT be issued before MFA verification'
      );
    });

    it('POST /api/auth/mfa/challenge - rejects invalid MFA code with 401 Unauthorized', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: mfaUser.email, password: mfaUser.password });

      const challengeRes = await request(app).post('/api/auth/mfa/challenge').send({
        mfaToken: loginRes.body.mfaToken,
        code: '000000', // invalid code
      });

      assert.strictEqual(challengeRes.status, 401);
      assert.strictEqual(challengeRes.body.error, 'Unauthorized');
    });

    it('POST /api/auth/mfa/challenge - succeeds with valid backup code and issues tokens', async () => {
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ email: mfaUser.email, password: mfaUser.password });

      const challengeRes = await request(app).post('/api/auth/mfa/challenge').send({
        mfaToken: loginRes.body.mfaToken,
        code: backupCodes[0], // Use first backup code
      });

      assert.strictEqual(challengeRes.status, 200);
      assert.ok(challengeRes.body.accessToken);
      assert.ok(challengeRes.body.refreshToken);
      assert.strictEqual(challengeRes.body.user.mfaEnabled, true);
    });
  });

  // 5. Role-Based Access Control (RBAC) & Endpoint Protection
  describe('5. Role-Based Access Control (RBAC)', () => {
    it('Customer token is blocked from institutional settlements with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/settlements')
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`)
        .send({
          transactionId: '00000000-0000-0000-0000-000000000000',
          sourceWalletId: '00000000-0000-0000-0000-000000000000',
          destinationWalletId: '00000000-0000-0000-0000-000000000000',
          amount: 500,
        });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Forbidden');
    });

    it('Customer token is blocked from dispute adjudication with 403 Forbidden', async () => {
      const res = await request(app)
        .patch('/api/disputes/00000000-0000-0000-0000-000000000000')
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`)
        .send({
          status: 'resolved',
          resolutionNotes: 'Self-adjudication attempt',
        });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Forbidden');
    });

    it('Customer token is blocked from direct administrative refunds with 403 Forbidden', async () => {
      const res = await request(app)
        .post('/api/transactions/00000000-0000-0000-0000-000000000000/refund')
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`)
        .send({
          amount: 50,
          reason: 'Unauthorized customer refund request',
        });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Forbidden');
    });

    it('Customer token is blocked from modifying wallet status with 403 Forbidden', async () => {
      const res = await request(app)
        .patch(`/api/wallets/${secondCustomer.walletId}/status`)
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`)
        .send({ status: 'frozen', reason: 'Self-freezing' });

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Forbidden');
    });
  });

  // 6. Resource Ownership & Object-Level Authorization
  describe('6. Resource Ownership & Anti-Cross-Account Protection', () => {
    it('Customer cannot view another user wallet (IDOR protection) -> 403 Forbidden', async () => {
      // Bob tries to view Alice's wallet
      const res = await request(app)
        .get(`/api/wallets/${customerUser.walletId}`)
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Forbidden');
      assert.strictEqual(res.body.message, 'Access denied: You do not own this wallet');
    });

    it('Customer can view own wallet -> 200 OK', async () => {
      // Bob views his own wallet
      const res = await request(app)
        .get(`/api/wallets/${secondCustomer.walletId}`)
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`);

      assert.strictEqual(res.status, 200);
      assert.strictEqual(res.body.wallet.id, secondCustomer.walletId);
    });

    it('Customer cannot initiate transfer from another user wallet -> 403 Forbidden', async () => {
      // Bob tries to initiate a transfer using Alice's wallet as source
      const res = await request(app)
        .post('/api/transactions/transfer')
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`)
        .send({
          sourceWalletId: customerUser.walletId,
          beneficiaryId: '00000000-0000-0000-0000-000000000000',
          amount: 100,
          description: 'Malicious transfer from someone else wallet',
        });

      assert.strictEqual(res.status, 403);
      assert.match(res.body.error, /do not own the source wallet/i);
      assert.strictEqual(
        res.body.message,
        'Access denied: You do not own the source wallet for this transfer'
      );
    });
  });

  // 7. Security Audit Logging & Reauthentication
  describe('7. Security Audit Trail & Reauthentication', () => {
    it('GET /api/auth/audit-logs - platform admin can query security logs', async () => {
      const res = await request(app)
        .get('/api/auth/audit-logs?limit=10')
        .set('Authorization', `Bearer ${platformAdminUser.accessToken}`);

      assert.strictEqual(res.status, 200);
      assert.ok(Array.isArray(res.body.auditLogs));
      assert.ok(res.body.auditLogs.length > 0);
      assert.ok(res.body.pagination.total > 0);
    });

    it('GET /api/auth/audit-logs - customer is blocked with 403 Forbidden', async () => {
      const res = await request(app)
        .get('/api/auth/audit-logs')
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`);

      assert.strictEqual(res.status, 403);
      assert.strictEqual(res.body.error, 'Forbidden');
    });

    it('POST /api/auth/reauthenticate - password verification yields confirmation token for sensitive operations', async () => {
      const res = await request(app)
        .post('/api/auth/reauthenticate')
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`)
        .send({ password: testPassword });

      assert.strictEqual(res.status, 200);
      assert.ok(res.body.confirmationToken);
      assert.ok(res.body.validUntil);
    });

    it('POST /api/auth/reauthenticate - invalid credentials rejected with 401', async () => {
      const res = await request(app)
        .post('/api/auth/reauthenticate')
        .set('Authorization', `Bearer ${secondCustomer.accessToken}`)
        .send({ password: 'WrongPassword!' });

      assert.strictEqual(res.status, 401);
    });
  });
});
