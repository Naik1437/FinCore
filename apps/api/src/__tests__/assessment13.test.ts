import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';
import request from 'supertest';
import { app } from '../index.js';
import { generateAccessToken } from '../services/auth.js';

describe('Assessment 13 — API Contracts & Documentation Tests', () => {
  const rootDir = path.resolve(__dirname, '../../../../');
  const openApiPath = path.join(rootDir, 'docs/openapi.json');
  const postmanCollectionPath = path.join(rootDir, 'docs/postman_collection.json');
  const postmanEnvPath = path.join(rootDir, 'docs/postman_environment.json');

  it('should provide complete OpenAPI 3.0.3 specification file with all registered routes', () => {
    assert.strictEqual(fs.existsSync(openApiPath), true, 'docs/openapi.json must exist');
    const spec = JSON.parse(fs.readFileSync(openApiPath, 'utf8'));

    assert.strictEqual(spec.openapi, '3.0.3');
    assert.ok(spec.info.title, 'Spec contains title');

    // Verify all registered routes exist in OpenAPI
    const requiredPaths = [
      '/health',
      '/api/auth/register',
      '/api/auth/login',
      '/api/auth/mfa/generate',
      '/api/auth/mfa/verify',
      '/api/accounts',
      '/api/wallets',
      '/api/wallets/{id}',
      '/api/transactions',
      '/api/transactions/transfer',
      '/api/transactions/{id}/refund',
      '/api/beneficiaries',
      '/api/holds',
      '/api/settlements',
      '/api/ledger/entries',
      '/api/disputes',
      '/api/statements',
      '/api/reports/reconciliation',
      '/api/payments/intents',
      '/api/webhooks/payments',
      '/api/notifications',
    ];

    for (const p of requiredPaths) {
      assert.ok(spec.paths[p], `OpenAPI specification must include path: ${p}`);
    }

    // Schemas & Security
    assert.ok(spec.components.securitySchemes.BearerAuth, 'Spec defines BearerAuth');
    assert.ok(
      spec.components.securitySchemes.WebhookHmacSignature,
      'Spec defines WebhookHmacSignature'
    );
    assert.ok(spec.components.schemas.Wallet, 'Spec defines Wallet schema');
    assert.ok(spec.components.schemas.Transaction, 'Spec defines Transaction schema');
    assert.ok(spec.components.schemas.LedgerEntry, 'Spec defines LedgerEntry schema');
  });

  it('should serve OpenAPI JSON specification via GET /docs/openapi.json', async () => {
    const res = await request(app).get('/docs/openapi.json');
    assert.strictEqual(res.status, 200);
    assert.strictEqual(res.body.openapi, '3.0.3');
    assert.strictEqual(res.body.info.title, 'FinCore Banking, Ledger & Payment API');
  });

  it('should serve Swagger UI interactive documentation via GET /docs', async () => {
    const res = await request(app).get('/docs');
    assert.strictEqual(res.status, 200);
    assert.match(res.text, /<div id="swagger-ui"><\/div>/, 'Renders Swagger UI element');
    assert.match(res.text, /url:\s*"\/docs\/openapi\.json"/, 'Loads openapi.json URL');
  });

  it('should provide importable Postman collection and environment templates covering registered routes', () => {
    assert.strictEqual(
      fs.existsSync(postmanCollectionPath),
      true,
      'docs/postman_collection.json must exist'
    );
    const collection = JSON.parse(fs.readFileSync(postmanCollectionPath, 'utf8'));
    assert.ok(collection.info.name, 'Collection contains name');
    assert.ok(collection.item.length >= 5, 'Collection contains requests across all domains');

    assert.strictEqual(
      fs.existsSync(postmanEnvPath),
      true,
      'docs/postman_environment.json must exist'
    );
    const env = JSON.parse(fs.readFileSync(postmanEnvPath, 'utf8'));
    assert.strictEqual(env.name, 'FinCore Local Environment');
    assert.ok(
      env.values.some((v: any) => v.key === 'baseUrl'),
      'Env defines baseUrl'
    );
  });

  it('should adhere to structured error response contracts', async () => {
    const adminToken = generateAccessToken({
      id: 'a0000000-0000-0000-0000-000000000005',
      email: 'platform.admin@fincore.internal',
      role: 'platform_administrator',
      fullName: 'Platform Admin',
    });
    const res = await request(app)
      .post('/api/transactions/transfer')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({});
    assert.strictEqual(res.status, 400);
    assert.ok(res.body.error, 'Contains standard error field');
  });
});
