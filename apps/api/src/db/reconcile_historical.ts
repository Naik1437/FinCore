import 'dotenv/config';
import { pool } from '../services/database.js';

export async function reconcileHistoricalLedger() {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    console.log('🔍 Checking for unbalanced historical ledger transactions...');

    const unbalancedRes = await client.query(`
      SELECT transaction_id, 
             COUNT(*) as entry_count, 
             SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debit,
             SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credit
      FROM ledger_entries
      GROUP BY transaction_id
      HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END)
    `);

    if (unbalancedRes.rows.length === 0) {
      console.log('✅ All transactions in ledger are already balanced!');
      await client.query('COMMIT');
      return { reconciledCount: 0, balanced: true };
    }

    console.log(
      `Found ${unbalancedRes.rows.length} unbalanced transactions. Preparing compensating entries...`
    );

    // 1. Get or create treasury user & wallet for genesis offsetting
    const treasuryUserRes = await client.query(
      "SELECT id FROM users WHERE email = 'treasury@fincore.internal'"
    );
    let treasuryUserId: string;
    if (treasuryUserRes.rows.length === 0) {
      const uRes = await client.query(
        "INSERT INTO users (email, full_name, is_verified) VALUES ('treasury@fincore.internal', 'FinCore System Treasury', true) RETURNING id"
      );
      treasuryUserId = uRes.rows[0].id;
    } else {
      treasuryUserId = treasuryUserRes.rows[0].id;
    }

    const treasuryWalletRes = await client.query(
      "SELECT id, balance FROM wallets WHERE user_id = $1 AND currency = 'USD' FOR UPDATE",
      [treasuryUserId]
    );
    let treasuryWalletId: string;
    if (treasuryWalletRes.rows.length === 0) {
      const wRes = await client.query(
        "INSERT INTO wallets (user_id, currency, balance, status) VALUES ($1, 'USD', 30000.0000, 'active') RETURNING id",
        [treasuryUserId]
      );
      treasuryWalletId = wRes.rows[0].id;
    } else {
      treasuryWalletId = treasuryWalletRes.rows[0].id;
    }

    // 2. Get or create settlement user & wallet for transfer offsetting
    const settlementUserRes = await client.query(
      "SELECT id FROM users WHERE email = 'settlement@fincore.internal'"
    );
    let settlementUserId: string;
    if (settlementUserRes.rows.length === 0) {
      const uRes = await client.query(
        "INSERT INTO users (email, full_name, is_verified) VALUES ('settlement@fincore.internal', 'FinCore Settlement Treasury', true) RETURNING id"
      );
      settlementUserId = uRes.rows[0].id;
    } else {
      settlementUserId = settlementUserRes.rows[0].id;
    }

    const settlementWalletRes = await client.query(
      "SELECT id, balance FROM wallets WHERE user_id = $1 AND currency = 'USD' FOR UPDATE",
      [settlementUserId]
    );
    let settlementWalletId: string;
    if (settlementWalletRes.rows.length === 0) {
      const wRes = await client.query(
        "INSERT INTO wallets (user_id, currency, balance, status) VALUES ($1, 'USD', 0.0000, 'active') RETURNING id",
        [settlementUserId]
      );
      settlementWalletId = wRes.rows[0].id;
    } else {
      settlementWalletId = settlementWalletRes.rows[0].id;
    }

    // 3. Process each unbalanced transaction
    for (const row of unbalancedRes.rows) {
      const txnId = row.transaction_id;
      const totalDebit = parseFloat(row.total_debit);
      const totalCredit = parseFloat(row.total_credit);

      if (totalCredit > totalDebit) {
        // Missing debit (e.g. Genesis deposit)
        const diff = (totalCredit - totalDebit).toFixed(4);
        const insRes = await client.query(
          `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
           VALUES ($1, $2, 'debit', $3::numeric(18, 4), 'USD', $3::numeric(18, 4), $4)
           RETURNING id`,
          [
            treasuryWalletId,
            txnId,
            diff,
            `Compensating reconciliation debit for transaction ${txnId.slice(0, 8)}`,
          ]
        );

        // Audit log
        await client.query(
          `INSERT INTO financial_audit_logs (entity_type, entity_id, action, actor_id, details)
           VALUES ('ledger_entry', $1, 'HISTORICAL_RECONCILIATION', 'system-auditor', $2)`,
          [
            insRes.rows[0].id,
            JSON.stringify({
              transactionId: txnId,
              compensatingType: 'debit',
              amount: diff,
              reason: 'Compensating balancing entry for unbalanced historical record',
            }),
          ]
        );
        console.log(`  ➕ Appended compensating DEBIT of USD ${diff} for transaction ${txnId}`);
      } else {
        // Missing credit (e.g. Transfers without settlement credit)
        const diff = (totalDebit - totalCredit).toFixed(4);
        const insRes = await client.query(
          `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
           VALUES ($1, $2, 'credit', $3::numeric(18, 4), 'USD', $3::numeric(18, 4), $4)
           RETURNING id`,
          [
            settlementWalletId,
            txnId,
            diff,
            `Compensating reconciliation credit for transaction ${txnId.slice(0, 8)}`,
          ]
        );

        // Audit log
        await client.query(
          `INSERT INTO financial_audit_logs (entity_type, entity_id, action, actor_id, details)
           VALUES ('ledger_entry', $1, 'HISTORICAL_RECONCILIATION', 'system-auditor', $2)`,
          [
            insRes.rows[0].id,
            JSON.stringify({
              transactionId: txnId,
              compensatingType: 'credit',
              amount: diff,
              reason: 'Compensating balancing entry for unbalanced historical record',
            }),
          ]
        );
        console.log(`  ➕ Appended compensating CREDIT of USD ${diff} for transaction ${txnId}`);
      }
    }

    // 4. Verify system equilibrium after reconciliation
    const postCheckRes = await client.query(`
      SELECT 
        SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) as total_debits,
        SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END) as total_credits
      FROM ledger_entries
    `);

    const finalDebits = parseFloat(postCheckRes.rows[0].total_debits);
    const finalCredits = parseFloat(postCheckRes.rows[0].total_credits);

    if (finalDebits !== finalCredits) {
      throw new Error(
        `Reconciliation failed ledger invariant: debits (${finalDebits}) != credits (${finalCredits})`
      );
    }

    await client.query('COMMIT');
    console.log(
      `✅ Historical reconciliation complete! System-wide balance: Debits = ${finalDebits}, Credits = ${finalCredits} (Difference: 0.0000)`
    );
    return {
      reconciledCount: unbalancedRes.rows.length,
      balanced: true,
      totalDebits: finalDebits,
      totalCredits: finalCredits,
    };
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Historical reconciliation failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

const isDirectRun =
  process.argv[1]?.endsWith('reconcile_historical.ts') ||
  process.argv[1]?.endsWith('reconcile_historical.js');
if (isDirectRun) {
  reconcileHistoricalLedger()
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
