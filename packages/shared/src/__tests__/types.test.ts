import assert from 'node:assert';
import { describe, it } from 'node:test';
import {
  ApiErrorSchema,
  CreateLedgerEntrySchema,
  CreateTransactionSchema,
  CreateWalletSchema,
  CurrencySchema,
  HealthCheckSchema,
  LedgerEntrySchema,
  LedgerEntryTypeSchema,
  LoginRequestSchema,
  MfaChallengeRequestSchema,
  MfaVerifyRequestSchema,
  PaginatedResponseSchema,
  PaginationSchema,
  RefreshTokenRequestSchema,
  RegisterRequestSchema,
  RoleSchema,
  TransactionSchema,
  TransactionStatusSchema,
  TransactionTypeSchema,
  UserProfileSchema,
  WalletSchema,
} from '../types.js';

describe('FinCore Shared Package — Types and Schemas Verification', () => {
  describe('1. Currency and Wallet Schemas', () => {
    it('CurrencySchema: accepts 3-letter currency codes and rejects invalid length', () => {
      assert.strictEqual(CurrencySchema.parse('USD'), 'USD');
      assert.strictEqual(CurrencySchema.parse('EUR'), 'EUR');
      assert.throws(() => CurrencySchema.parse('US'), /exactly 3 characters/);
      assert.throws(() => CurrencySchema.parse('USDD'), /exactly 3 characters/);
    });

    it('WalletSchema: validates complete wallet records', () => {
      const validWallet = {
        id: '11111111-1111-4111-8111-111111111111',
        userId: '22222222-2222-4111-8111-222222222222',
        currency: 'USD',
        balance: 1500.5,
        createdAt: '2026-01-01T00:00:00Z',
        updatedAt: '2026-01-01T00:00:00Z',
      };
      const parsed = WalletSchema.parse(validWallet);
      assert.strictEqual(parsed.id, validWallet.id);
      assert.strictEqual(parsed.balance, 1500.5);

      assert.throws(
        () => WalletSchema.parse({ ...validWallet, balance: -10 }),
        />=0/
      );
    });

    it('CreateWalletSchema: applies default currency and zero initial balance', () => {
      const parsed = CreateWalletSchema.parse({
        userId: '33333333-3333-4111-8111-333333333333',
      });
      assert.strictEqual(parsed.currency, 'USD');
      assert.strictEqual(parsed.initialBalance, 0);
    });
  });

  describe('2. Transaction and Ledger Schemas', () => {
    it('TransactionTypeSchema & StatusSchema: enforces allowed financial lifecycle states', () => {
      assert.strictEqual(TransactionTypeSchema.parse('transfer'), 'transfer');
      assert.strictEqual(TransactionTypeSchema.parse('payment'), 'payment');
      assert.throws(() => TransactionTypeSchema.parse('invalid_type'));

      assert.strictEqual(TransactionStatusSchema.parse('pending'), 'pending');
      assert.strictEqual(TransactionStatusSchema.parse('completed'), 'completed');
      assert.strictEqual(TransactionStatusSchema.parse('failed'), 'failed');
      assert.throws(() => TransactionStatusSchema.parse('unknown_status'));
    });

    it('TransactionSchema: requires positive amount and valid UUIDs', () => {
      const validTx = {
        id: '44444444-4444-4111-8111-444444444444',
        walletId: '55555555-5555-4111-8111-555555555555',
        type: 'transfer',
        amount: 250.75,
        currency: 'USD',
        status: 'completed',
        description: 'Simulated payment',
        createdAt: '2026-01-01T12:00:00Z',
        updatedAt: '2026-01-01T12:00:00Z',
      };
      assert.strictEqual(TransactionSchema.parse(validTx).amount, 250.75);
      assert.throws(
        () => TransactionSchema.parse({ ...validTx, amount: 0 }),
        />0/
      );
      assert.throws(
        () => TransactionSchema.parse({ ...validTx, amount: -50 }),
        />0/
      );
    });

    it('LedgerEntrySchema: enforces debit and credit entries with balanceAfter', () => {
      assert.strictEqual(LedgerEntryTypeSchema.parse('debit'), 'debit');
      assert.strictEqual(LedgerEntryTypeSchema.parse('credit'), 'credit');
      assert.throws(() => LedgerEntryTypeSchema.parse('refund_type'));

      const validLedger = {
        id: '66666666-6666-4111-8111-666666666666',
        walletId: '77777777-7777-4111-8111-777777777777',
        transactionId: '88888888-8888-4111-8111-888888888888',
        entryType: 'credit',
        amount: 100.0,
        currency: 'USD',
        balanceAfter: 600.0,
        createdAt: '2026-01-01T12:00:00Z',
      };
      const parsed = LedgerEntrySchema.parse(validLedger);
      assert.strictEqual(parsed.entryType, 'credit');
      assert.strictEqual(parsed.balanceAfter, 600.0);
    });

    it('CreateLedgerEntrySchema: defaults currency to USD', () => {
      const parsed = CreateLedgerEntrySchema.parse({
        walletId: '77777777-7777-4111-8111-777777777777',
        transactionId: '88888888-8888-4111-8111-888888888888',
        entryType: 'debit',
        amount: 45.0,
      });
      assert.strictEqual(parsed.currency, 'USD');
    });
  });

  describe('3. Security, Authentication & RBAC Schemas', () => {
    it('RoleSchema: accepts all 5 standard FinCore roles and backwards-compatible operations alias', () => {
      const roles = [
        'customer',
        'support_agent',
        'operations_analyst',
        'finance_administrator',
        'platform_administrator',
        'operations',
      ];
      roles.forEach(r => assert.strictEqual(RoleSchema.parse(r), r));
      assert.throws(() => RoleSchema.parse('super_root'));
    });

    it('UserProfileSchema: validates user profile fields and defaults flags', () => {
      const profile = {
        id: '99999999-9999-4111-8111-999999999999',
        email: 'alice@fincore.internal',
        fullName: 'Alice Developer',
        role: 'platform_administrator',
      };
      const parsed = UserProfileSchema.parse(profile);
      assert.strictEqual(parsed.mfaEnabled, false);
      assert.strictEqual(parsed.isVerified, false);
      assert.strictEqual(parsed.role, 'platform_administrator');
    });

    it('RegisterRequestSchema: validates email format and password length minimum', () => {
      const valid = {
        email: 'bob@example.com',
        password: 'ValidPassword123!',
        fullName: 'Bob Smith',
      };
      assert.strictEqual(RegisterRequestSchema.parse(valid).email, 'bob@example.com');
      assert.throws(() => RegisterRequestSchema.parse({ ...valid, email: 'not-an-email' }));
      assert.throws(() => RegisterRequestSchema.parse({ ...valid, password: 'short' }), /Password must be at least 8 characters/);
      assert.throws(() => RegisterRequestSchema.parse({ ...valid, fullName: '' }), /Full name is required/);
    });

    it('MfaVerifyRequestSchema & MfaChallengeRequestSchema: validates TOTP codes', () => {
      assert.strictEqual(
        MfaVerifyRequestSchema.parse({ secret: 'JBSWY3DPEHPK3PXP', code: '123456' }).code,
        '123456'
      );
      assert.throws(
        () => MfaVerifyRequestSchema.parse({ secret: 'sec', code: '12345' }),
        /Verification code must be 6 digits/
      );

      assert.strictEqual(
        MfaChallengeRequestSchema.parse({ mfaToken: 'jwt.token.here', code: '123456' }).code,
        '123456'
      );
    });
  });

  describe('4. Infrastructure, Pagination & Error Schemas', () => {
    it('HealthCheckSchema: validates system health payload structure', () => {
      const health = {
        status: 'healthy',
        timestamp: '2026-01-01T00:00:00Z',
        uptime: 3600,
        environment: 'production',
        version: '1.0.0',
        services: {
          database: 'healthy',
          redis: 'healthy',
        },
      };
      const parsed = HealthCheckSchema.parse(health);
      assert.strictEqual(parsed.status, 'healthy');
      assert.strictEqual(parsed.services.database, 'healthy');
    });

    it('ApiErrorSchema: requires error string and numeric statusCode', () => {
      const err = {
        error: 'Forbidden',
        message: 'Access denied: role not permitted',
        statusCode: 403,
      };
      const parsed = ApiErrorSchema.parse(err);
      assert.strictEqual(parsed.statusCode, 403);
      assert.throws(() => ApiErrorSchema.parse({ error: 'Missing status' }));
    });

    it('PaginationSchema & PaginatedResponseSchema: enforces bounded page limits', () => {
      const p = PaginationSchema.parse({});
      assert.strictEqual(p.page, 1);
      assert.strictEqual(p.limit, 20);

      assert.throws(
        () => PaginationSchema.parse({ limit: 500 }),
        /<=100/
      );

      const PagedWallets = PaginatedResponseSchema(WalletSchema);
      const res = PagedWallets.parse({
        items: [],
        pagination: {
          page: 1,
          limit: 20,
          total: 0,
          totalPages: 0,
        },
      });
      assert.strictEqual(res.pagination.total, 0);
    });
  });
});
