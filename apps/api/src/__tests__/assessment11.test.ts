import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('Assessment 11 — Secure Financial CI/CD Pipeline Tests', () => {
  const rootDir = path.resolve(__dirname, '../../../../');
  const ciWorkflowPath = path.join(rootDir, '.github/workflows/ci.yml');
  const deploymentDocPath = path.join(rootDir, 'docs/DEPLOYMENT_AND_ROLLBACK.md');

  it('should define a comprehensive GitHub Actions CI/CD workflow', () => {
    assert.strictEqual(fs.existsSync(ciWorkflowPath), true, '.github/workflows/ci.yml must exist');
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');

    // 1. Least privilege permissions
    assert.match(
      content,
      /permissions:\s+contents:\s+read/i,
      'Defines least privilege contents: read permission'
    );

    // 2. Security & Vulnerability Scanning (Free tools)
    assert.match(content, /security-scan:/, 'Declares security scan job');
    assert.match(content, /npm audit/, 'Includes Node.js dependency audit');
    assert.match(content, /pip-audit/, 'Includes Python dependency audit');
    assert.match(content, /Secret Scan Protection/, 'Includes git tracked secret scan protection');

    // 3. Linting, Typing & Governance
    assert.match(content, /lint-and-typecheck:/, 'Declares lint and typecheck job');
    assert.match(content, /typecheck --workspace=@fincore\/api/, 'Typechecks API');
    assert.match(content, /typecheck --workspace=@fincore\/web/, 'Typechecks Web');

    // 4. PostgreSQL & Redis integration services
    assert.match(
      content,
      /test-and-financial-integrity:/,
      'Declares test and financial integrity job'
    );
    assert.match(
      content,
      /image:\s+postgres:17/,
      'Integrates PostgreSQL 17 test container service'
    );
    assert.match(content, /image:\s+redis:7/, 'Integrates Redis 7 test container service');
    assert.match(content, /pg_isready/, 'PostgreSQL healthcheck configured');
    assert.match(content, /redis-cli ping/, 'Redis healthcheck configured');

    // 5. Financial Integrity Gates
    assert.match(content, /assessment03\.test\.ts/, 'Runs double-entry ledger database tests');
    assert.match(content, /assessment07\.test\.ts/, 'Runs transfer consistency engine tests');
    assert.match(
      content,
      /pytest tests\/test_calculations\.py/,
      'Runs Python financial calculations tests'
    );

    // 6. Test Reports Artifacts
    assert.match(content, /upload-artifact@v4/, 'Uploads test results artifact');

    // 7. Multi-Stage Docker Build & Container Vulnerability Scan
    assert.match(content, /container-build-and-verify:/, 'Declares container build and verify job');
    assert.match(content, /docker compose config/, 'Validates Docker Compose config');
    assert.match(
      content,
      /aquasecurity\/trivy-action/,
      'Includes free Trivy container vulnerability scan'
    );

    // 8. Staged Deployment & Automated Rollback
    assert.match(content, /deploy-staging:/, 'Declares staging deployment stage');
    assert.match(content, /deploy-production:/, 'Declares production deployment stage');
    assert.match(
      content,
      /Post-Deployment Financial Reconciliation Guard/,
      'Includes post-deployment ledger reconciliation guard'
    );
  });

  it('should define robust zero-downtime deployment and automated rollback procedures', () => {
    assert.strictEqual(
      fs.existsSync(deploymentDocPath),
      true,
      'docs/DEPLOYMENT_AND_ROLLBACK.md must exist'
    );
    const content = fs.readFileSync(deploymentDocPath, 'utf8');
    assert.match(content, /Blue\/Green/i, 'Specifies Blue/Green or canary deployment architecture');
    assert.match(
      content,
      /Automated Canary Rollback Triggers/i,
      'Defines automated rollback triggers (5xx errors, latency, ledger variance)'
    );
    assert.match(
      content,
      /Compensating Financial Journal Entries/i,
      'Specifies compensating journal entries rather than destructive DB rollbacks'
    );
    assert.match(
      content,
      /Secret & Token Revocation/i,
      'Details token revocation and Redis flush on security incidents'
    );
  });
});
