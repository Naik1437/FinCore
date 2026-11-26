import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('Assessment 14 — Secure Deployment & Recovery Tests', () => {
  const rootDir = path.resolve(__dirname, '../../../../');
  const backupScriptPath = path.join(rootDir, 'scripts/backup.sh');
  const restoreScriptPath = path.join(rootDir, 'scripts/restore.sh');
  const nginxConfPath = path.join(rootDir, 'docker/nginx.conf');
  const drRunbookPath = path.join(rootDir, 'docs/DISASTER_RECOVERY_AND_RUNBOOK.md');
  const deploymentDocPath = path.join(rootDir, 'docs/DEPLOYMENT_AND_ROLLBACK.md');

  it('should provide automated PostgreSQL backup script with checksum hashing and retention', () => {
    assert.strictEqual(fs.existsSync(backupScriptPath), true, 'scripts/backup.sh must exist');
    const content = fs.readFileSync(backupScriptPath, 'utf8');

    assert.match(content, /pg_dump/, 'Must use pg_dump');
    assert.match(content, /gzip/, 'Must compress backup');
    assert.match(content, /sha256sum/, 'Must compute SHA256 checksum for audit trail');
    assert.match(content, /find.*-mtime \+30 -delete/i, 'Must enforce retention policy');
  });

  it('should provide disaster recovery restoration script targeting isolated verification database', () => {
    assert.strictEqual(fs.existsSync(restoreScriptPath), true, 'scripts/restore.sh must exist');
    const content = fs.readFileSync(restoreScriptPath, 'utf8');

    assert.match(content, /CREATE DATABASE/i, 'Must provision verification database');
    assert.match(content, /DROP DATABASE IF EXISTS/i, 'Must clean up verification database');
    assert.match(content, /sha256sum -c/, 'Must verify SHA256 checksum integrity');
    assert.match(
      content,
      /ledger_entries/i,
      'Must validate double-entry balance equilibrium after restoration'
    );
    assert.match(
      content,
      /SUM\(CASE WHEN entry_type = 'debit'/i,
      'Asserts debit/credit equilibrium'
    );
  });

  it('should configure production Nginx reverse proxy with TLS and security hardening', () => {
    assert.strictEqual(fs.existsSync(nginxConfPath), true, 'docker/nginx.conf must exist');
    const content = fs.readFileSync(nginxConfPath, 'utf8');

    assert.match(content, /ssl_protocols TLSv1\.2 TLSv1\.3;/, 'Enforces TLS 1.2 and 1.3');
    assert.match(content, /X-Frame-Options "DENY"/, 'Includes X-Frame-Options');
    assert.match(content, /X-Content-Type-Options "nosniff"/, 'Includes nosniff header');
    assert.match(content, /Strict-Transport-Security/, 'Includes HSTS header');
    assert.match(content, /limit_req_zone/, 'Configures rate limiting zone');
    assert.match(content, /listen 80;[\s\S]*return 301 https:/, 'Redirects HTTP to HTTPS');
  });

  it('should document rigorous RTO, RPO, and disaster recovery runbooks', () => {
    assert.strictEqual(
      fs.existsSync(drRunbookPath),
      true,
      'docs/DISASTER_RECOVERY_AND_RUNBOOK.md must exist'
    );
    const content = fs.readFileSync(drRunbookPath, 'utf8');

    assert.match(content, /Recovery Point Objective \(RPO\)/i, 'Documents RPO metric');
    assert.match(content, /Recovery Time Objective \(RTO\)/i, 'Documents RTO metric');
    assert.match(content, /Isolation Testing Mandate/i, 'Documents isolation testing mandate');
    assert.match(
      content,
      /Mandatory External Cloud Deployment Blockers/i,
      'Documents cloud migration blockers & prerequisites'
    );
  });

  it('should document deployment rollback and financial data integrity safeguards', () => {
    assert.strictEqual(
      fs.existsSync(deploymentDocPath),
      true,
      'docs/DEPLOYMENT_AND_ROLLBACK.md must exist'
    );
    const content = fs.readFileSync(deploymentDocPath, 'utf8');

    assert.match(content, /Canary/i, 'Documents Canary/Blue-Green deployment');
    assert.match(
      content,
      /Compensating Financial Journal Entries/i,
      'Guarantees compensating journal entries during rollbacks'
    );
  });
});
