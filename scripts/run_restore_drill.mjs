import { execSync } from 'child_process';
import crypto from 'crypto';
import fs from 'fs';

// Read BACKUP_ENCRYPTION_KEY from process.env or .env file
let encKey = process.env.BACKUP_ENCRYPTION_KEY;
if (!encKey && fs.existsSync('.env')) {
  const envContent = fs.readFileSync('.env', 'utf8');
  const match = envContent.match(/BACKUP_ENCRYPTION_KEY=([^\r\n]+)/);
  if (match) encKey = match[1].trim();
}
if (!encKey) {
  encKey = 'fincore_backup_master_key_32_characters_minimum_entropy';
}

// Derive a 32-byte key using SHA-256
const derivedKey = crypto.createHash('sha256').update(encKey).digest();

console.log('1. Creating backup of fincore database...');
if (!fs.existsSync('backups')) fs.mkdirSync('backups');
const timestamp = Date.now();
const backupFile = `backups/drill_backup_${timestamp}.sql`;
const encFile = `${backupFile}.enc`;
const decFile = `${backupFile}.dec.sql`;

execSync(`docker exec fincore-postgres pg_dump -U fincore -d fincore --clean --if-exists > ${backupFile}`);
console.log(`   Raw SQL dump created at ${backupFile} (${fs.statSync(backupFile).size} bytes)`);

console.log('2. Encrypting backup with AES-256-CBC and generating SHA256 checksum...');
const iv = crypto.randomBytes(16);
const cipher = crypto.createCipheriv('aes-256-cbc', derivedKey, iv);
const rawData = fs.readFileSync(backupFile);
const encryptedData = Buffer.concat([iv, cipher.update(rawData), cipher.final()]);
fs.writeFileSync(encFile, encryptedData);
fs.unlinkSync(backupFile); // Purge unencrypted dump

const sha256 = crypto.createHash('sha256').update(encryptedData).digest('hex');
fs.writeFileSync(`${encFile}.sha256`, `${sha256}  ${encFile}\n`);
console.log(`   Encrypted backup: ${encFile} (${fs.statSync(encFile).size} bytes)`);
console.log(`   SHA256 checksum: ${sha256}`);

console.log('3. Verifying integrity and decrypting backup archive...');
const encReadData = fs.readFileSync(encFile);
const checkSha256 = crypto.createHash('sha256').update(encReadData).digest('hex');
if (checkSha256 !== sha256) throw new Error('Integrity checksum verification failed!');

const readIv = encReadData.subarray(0, 16);
const decipher = crypto.createDecipheriv('aes-256-cbc', derivedKey, readIv);
const decryptedData = Buffer.concat([decipher.update(encReadData.subarray(16)), decipher.final()]);
fs.writeFileSync(decFile, decryptedData);
console.log(`   Decrypted data verified successfully (${decryptedData.length} bytes).`);

const testDbName = `fincore_dr_isolated_${timestamp}`;
console.log(`4. Provisioning temporary isolated database: ${testDbName}`);
execSync(`docker exec fincore-postgres psql -U fincore -d postgres -c "CREATE DATABASE ${testDbName};"`);

try {
  console.log('5. Restoring decrypted backup into isolated database...');
  execSync(`docker exec -i fincore-postgres psql -U fincore -d ${testDbName} < ${decFile}`);
  
  console.log('6. Auditing double-entry ledger invariants on restored isolated database...');
  const query = "SELECT COUNT(*) FROM (SELECT transaction_id FROM ledger_entries GROUP BY transaction_id HAVING SUM(CASE WHEN entry_type = 'debit' THEN amount ELSE 0 END) != SUM(CASE WHEN entry_type = 'credit' THEN amount ELSE 0 END)) unbal;";
  const auditRes = execSync(`docker exec fincore-postgres psql -U fincore -d ${testDbName} -t -A -c "${query}"`);
  
  const unbalCount = parseInt(auditRes.toString().trim(), 10);
  console.log(`   Unbalanced transactions on restored database: ${unbalCount}`);
  if (unbalCount === 0) {
    console.log('   ISOLATED RESTORE DRILL VERIFICATION: PASSED (Zero ledger discrepancies)');
  } else {
    throw new Error('Restored database contains unbalanced entries');
  }
} finally {
  console.log('7. Cleaning up temporary artifacts and tearing down isolated database...');
  if (fs.existsSync(decFile)) fs.unlinkSync(decFile);
  if (fs.existsSync(encFile)) fs.unlinkSync(encFile);
  if (fs.existsSync(`${encFile}.sha256`)) fs.unlinkSync(`${encFile}.sha256`);
  execSync(`docker exec fincore-postgres psql -U fincore -d postgres -c "DROP DATABASE IF EXISTS ${testDbName};"`);
  console.log('   Cleanup completed cleanly. Live database untouched.');
}
