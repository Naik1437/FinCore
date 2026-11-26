import assert from 'node:assert';
import { after, describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../index.js';
import { pool } from '../services/database.js';
import { generateAccessToken } from '../services/auth.js';

describe('FinCore Security Verification — MFA, RBAC & Demo Access Restrictions', () => {
  let customerToken: string;
  let customerEmail: string;
  const customerPassword = 'RoleSecurePassword123!';
  let customerUserId: string;
  let customerWalletId: string;
  let opsToken: string;
  let financeAdminToken: string;

  const adminToken = generateAccessToken({
    id: 'a0000000-0000-0000-0000-000000000005',
    email: 'platform.admin@fincore.internal',
    role: 'platform_administrator',
    fullName: 'Platform Admin',
  });

  it('Setup: Provisions users across RBAC roles', async () => {
    const timestamp = Date.now();
    customerEmail = `mfa.cust.${timestamp}@example.com`;

    // 1. Customer
    const custRes = await request(app).post('/api/auth/register').send({
      email: customerEmail,
      fullName: 'Customer Security User',
      password: customerPassword,
    });
    assert.strictEqual(custRes.status, 201);
    customerUserId = custRes.body.user.id;
    customerToken = custRes.body.accessToken;

    const wRes = await request(app)
      .post('/api/wallets')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        userId: customerUserId,
        currency: 'USD',
        initialBalance: 250.0,
      });
    assert.strictEqual(wRes.status, 201);
    customerWalletId = wRes.body.wallet.id;

    // 2. Ops Analyst
    const opsRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `mfa.ops.${timestamp}@example.com`,
        fullName: 'Operations Analyst User',
        password: customerPassword,
      });
    assert.strictEqual(opsRes.status, 201);
    await pool.query("UPDATE users SET role = 'operations_analyst' WHERE id = $1", [
      opsRes.body.user.id,
    ]);
    const opsLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: `mfa.ops.${timestamp}@example.com`,
        password: customerPassword,
      });
    opsToken = opsLogin.body.accessToken;

    // 3. Finance Administrator
    const finRes = await request(app)
      .post('/api/auth/register')
      .send({
        email: `mfa.fin.${timestamp}@example.com`,
        fullName: 'Finance Admin User',
        password: customerPassword,
      });
    assert.strictEqual(finRes.status, 201);
    await pool.query("UPDATE users SET role = 'finance_administrator' WHERE id = $1", [
      finRes.body.user.id,
    ]);
    const finLogin = await request(app)
      .post('/api/auth/login')
      .send({
        email: `mfa.fin.${timestamp}@example.com`,
        password: customerPassword,
      });
    financeAdminToken = finLogin.body.accessToken;
  });

  it('MFA: Sets up simulated TOTP secret, backup codes and otpauth URL via /api/auth/mfa/setup', async () => {
    const setupRes = await request(app)
      .post('/api/auth/mfa/setup')
      .set('Authorization', `Bearer ${customerToken}`);

    assert.strictEqual(setupRes.status, 200);
    assert.ok(setupRes.body.secret, 'Must return TOTP secret');
    assert.ok(Array.isArray(setupRes.body.backupCodes), 'Must return backup recovery codes');
    assert.strictEqual(setupRes.body.backupCodes.length, 4, 'Must have 4 backup codes');
    assert.ok(setupRes.body.otpauthUrl, 'Must return otpauth URL');
  });

  it('MFA: Rejects invalid TOTP code on /api/auth/mfa/verify', async () => {
    const badCodeRes = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ code: '999999' });

    assert.strictEqual(badCodeRes.status, 400);
    assert.strictEqual(badCodeRes.body.error, 'Bad Request');
  });

  it('MFA: Activates MFA with valid verification code (123456)', async () => {
    const goodCodeRes = await request(app)
      .post('/api/auth/mfa/verify')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ code: '123456' });

    assert.strictEqual(goodCodeRes.status, 200);
    assert.strictEqual(goodCodeRes.body.success, true);
  });

  it('MFA Challenge: Login requires MFA challenge and rejects invalid code', async () => {
    // Attempt standard login with MFA-enabled account
    const loginRes = await request(app).post('/api/auth/login').send({
      email: customerEmail,
      password: customerPassword,
    });

    assert.strictEqual(loginRes.status, 200);
    assert.strictEqual(loginRes.body.mfaRequired, true);
    assert.ok(loginRes.body.mfaToken, 'Must issue mfaToken');

    const mfaToken = loginRes.body.mfaToken;

    // Challenge with invalid OTP code
    const invalidChallenge = await request(app).post('/api/auth/mfa/challenge').send({
      mfaToken,
      code: '000000',
    });
    assert.strictEqual(invalidChallenge.status, 401);
    assert.strictEqual(invalidChallenge.body.error, 'Unauthorized');

    // Challenge with valid OTP code
    const validChallenge = await request(app).post('/api/auth/mfa/challenge').send({
      mfaToken,
      code: '123456',
    });
    assert.strictEqual(validChallenge.status, 200);
    assert.ok(validChallenge.body.accessToken, 'Must issue authenticated JWT accessToken');
    assert.strictEqual(validChallenge.body.user.mfaEnabled, true);
  });

  it('Security: Restricts demo persona and webhook simulator in production environment', async () => {
    const originalEnv = process.env.NODE_ENV;
    try {
      process.env.NODE_ENV = 'production';

      // 1. Webhook simulator should be blocked in production
      const simRes = await request(app)
        .post('/api/webhooks/simulate')
        .set('Authorization', `Bearer ${opsToken}`)
        .send({
          type: 'payment_intent.succeeded',
          amount: 100,
          currency: 'USD',
        });
      assert.strictEqual(simRes.status, 403);
      assert.strictEqual(simRes.body.error, 'Forbidden');

      // 2. Demo persona login should be blocked in production
      const demoLogin = await request(app).post('/api/auth/login').send({
        email: 'customer@fincore.internal',
        password: 'Password123!',
      });
      assert.strictEqual(demoLogin.status, 403);
      assert.strictEqual(demoLogin.body.error, 'Forbidden');
    } finally {
      process.env.NODE_ENV = originalEnv;
    }
  });

  it('RBAC: Customers are blocked from institutional settlements and admin disputes', async () => {
    const setRes = await request(app)
      .post('/api/settlements')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        transactionId: '00000000-0000-0000-0000-000000000000',
        sourceWalletId: '00000000-0000-0000-0000-000000000000',
        destinationWalletId: '00000000-0000-0000-0000-000000000000',
        amount: 500,
      });
    assert.strictEqual(setRes.status, 403);
    assert.strictEqual(setRes.body.error, 'Forbidden');

    const dispRes = await request(app)
      .patch('/api/disputes/00000000-0000-0000-0000-000000000000')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({
        status: 'resolved',
        resolutionNotes: 'Illegal resolution',
      });
    assert.strictEqual(dispRes.status, 403);
    assert.strictEqual(dispRes.body.error, 'Forbidden');
  });

  it('RBAC: Privileged roles (Finance Admin & Ops) can access protected operations', async () => {
    const finSetRes = await request(app)
      .get('/api/settlements')
      .set('Authorization', `Bearer ${financeAdminToken}`);
    assert.strictEqual(finSetRes.status, 200);

    const opsDispRes = await request(app)
      .get('/api/disputes')
      .set('Authorization', `Bearer ${opsToken}`);
    assert.strictEqual(opsDispRes.status, 200);
  });

  after(async () => {
    try {
      await pool.end();
    } catch (_e) {}
    try {
      const { disconnectRedis } = await import('../services/redis.js');
      await disconnectRedis();
    } catch (_e) {}
  });
});
