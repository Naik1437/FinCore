import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { pool } from '../services/database.js';

export async function runMigrations() {
  const client = await pool.connect();
  try {
    console.log('🔄 Running database migrations...');

    const scripts = [
      '01-init.sql',
      '02-assessment03-ledger-engine.sql',
      '03-assessment04-auth-security.sql',
      '07-customer-resources.sql',
      '04-assessment07-transfer-engine.sql',
      '05-assessment08-payment-notifications.sql',
      '06-journal-integrity.sql',
    ];

    for (const script of scripts) {
      const migrationPath = path.resolve(process.cwd(), '../../scripts/init-db', script);
      if (!fs.existsSync(migrationPath)) throw new Error('Missing migration: ' + script);
      if (script === '01-init.sql') {
        const state = await client.query("SELECT to_regclass('public.transactions') AS existing");
        if (state.rows[0].existing) continue;
      }
      {
        console.log(`Executing ${script}...`);
        const sql = fs.readFileSync(migrationPath, 'utf8');
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('COMMIT');
        console.log(`✅ ${script} applied successfully.`);
      }
    }

    console.log('✅ All migrations applied successfully.');
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

const isDirectRun =
  process.argv[1]?.endsWith('migrate.ts') || process.argv[1]?.endsWith('migrate.js');
if (isDirectRun) {
  runMigrations()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async err => {
      console.error(err);
      await pool.end();
      process.exit(1);
    });
}
