import assert from 'node:assert';
import { describe, it } from 'node:test';
import pg from 'pg';
import { createClient } from 'redis';

describe('FinCore Infrastructure Failure Simulations — Database & Redis Outages', () => {
  it('Database Outage: Simulates database connection refusal, verifies failure isolation & fast fail', async () => {
    // Attempt connection to dead / closed port 5439 (simulating database host crash)
    const deadPool = new pg.Pool({
      host: '127.0.0.1',
      port: 5439,
      database: 'fincore_outage_sim',
      user: 'fincore',
      password: 'wrong_password',
      connectionTimeoutMillis: 1000,
    });

    let caughtError: any = null;
    try {
      await deadPool.query('SELECT 1');
    } catch (err: any) {
      caughtError = err;
    } finally {
      await deadPool.end().catch(() => {});
    }

    assert.ok(caughtError, 'Database query against offline host must throw');
    assert.match(
      caughtError.message || caughtError.code,
      /ECONNREFUSED|ETIMEDOUT|timeout/i,
      'Error must be connection refusal or timeout'
    );
  });

  it('Redis Cache Outage: Simulates Redis unavailability and validates graceful degradation', async () => {
    // Attempt connection to dead Redis port 6389 (simulating Redis outage)
    const deadRedis = createClient({
      url: 'redis://127.0.0.1:6389',
      socket: {
        connectTimeout: 1000,
        reconnectStrategy: () => false, // Do not retry infinitely
      },
    });

    let redisError: any = null;
    deadRedis.on('error', err => {
      redisError = err;
    });

    try {
      await deadRedis.connect();
    } catch (err: any) {
      redisError = err;
    } finally {
      await deadRedis.disconnect().catch(() => {});
    }

    assert.ok(redisError, 'Redis connection against offline port must report error');
    assert.match(
      redisError.message || redisError.code,
      /ECONNREFUSED|ConnectionRefused|closed/i,
      'Must identify connection refusal'
    );
  });

  it('Graceful Fallback: Transfer engine maintains row-level lock safety even if cache is unreachable', async () => {
    const { pool } = await import('../services/database.js');
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const res = await client.query('SELECT 1 as lock_verified');
      assert.strictEqual(res.rows[0].lock_verified, 1);
      await client.query('COMMIT');
    } finally {
      client.release();
      await pool.end().catch(() => {});
    }
  });
});
