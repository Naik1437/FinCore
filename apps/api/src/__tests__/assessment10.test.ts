import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('Assessment 10 — Git & Change Governance Tests', () => {
  const rootDir = path.resolve(__dirname, '../../../../');
  const codeownersPath = path.join(rootDir, '.github/CODEOWNERS');
  const prTemplatePath = path.join(rootDir, '.github/PULL_REQUEST_TEMPLATE.md');
  const issueTemplateDir = path.join(rootDir, '.github/ISSUE_TEMPLATE');
  const rfcTemplatePath = path.join(issueTemplateDir, 'financial_change_request.yml');
  const gitGovernanceDocPath = path.join(rootDir, 'docs/GIT_GOVERNANCE.md');
  const financialAuditDocPath = path.join(rootDir, 'docs/FINANCIAL_CHANGE_AUDIT.md');
  const ciWorkflowPath = path.join(rootDir, '.github/workflows/ci.yml');
  const gitignorePath = path.join(rootDir, '.gitignore');

  it('should define CODEOWNERS with strict financial, security, and infrastructure domain boundaries', () => {
    assert.strictEqual(
      fs.existsSync(codeownersPath),
      true,
      'CODEOWNERS file must exist in .github/'
    );
    const content = fs.readFileSync(codeownersPath, 'utf8');
    assert.match(
      content,
      /ledger\.ts.*@financial-engineers/,
      'Ledger service owned by financial engineers'
    );
    assert.match(
      content,
      /consistencyEngine\.ts.*@concurrency-lead/,
      'Transfer consistency owned by concurrency lead'
    );
    assert.match(
      content,
      /middleware\/auth\.ts.*@security-officer/,
      'Auth middleware owned by security officer'
    );
    assert.match(
      content,
      /docker-compose\.yml.*@devops-lead/,
      'Infrastructure owned by DevOps lead'
    );
  });

  it('should define a comprehensive pull request template with financial governance checklist', () => {
    assert.strictEqual(
      fs.existsSync(prTemplatePath),
      true,
      'PULL_REQUEST_TEMPLATE.md must exist in .github/'
    );
    const content = fs.readFileSync(prTemplatePath, 'utf8');
    assert.match(content, /Double-Entry Equilibrium/i, 'Must check double entry balance');
    assert.match(content, /Data Immutability/i, 'Must check data immutability');
    assert.match(
      content,
      /Concurrency & Idempotency/i,
      'Must check concurrency locks and idempotency'
    );
    assert.match(content, /Decimal Precision/i, 'Must check decimal precision');
  });

  it('should define issue templates for Financial Change Requests (RFC) and Financial Bug Reports', () => {
    assert.strictEqual(
      fs.existsSync(rfcTemplatePath),
      true,
      'financial_change_request.yml must exist'
    );
    const content = fs.readFileSync(rfcTemplatePath, 'utf8');
    assert.match(content, /Financial Change Request/i, 'Should be an RFC for financial changes');
    assert.match(content, /Double-entry balance equilibrium/i, 'Should enforce double entry');
  });

  it('should provide comprehensive Git Governance and Financial Change documentation', () => {
    assert.strictEqual(
      fs.existsSync(gitGovernanceDocPath),
      true,
      'docs/GIT_GOVERNANCE.md must exist'
    );
    const govContent = fs.readFileSync(gitGovernanceDocPath, 'utf8');
    assert.match(govContent, /Conventional Commit/i, 'Must specify conventional commits');
    assert.match(govContent, /feat|fix|sec|audit|perf/, 'Must define financial commit types');
    assert.match(govContent, /Semantic Versioning/i, 'Must document release management / SemVer');

    assert.strictEqual(
      fs.existsSync(financialAuditDocPath),
      true,
      'docs/FINANCIAL_CHANGE_AUDIT.md must exist'
    );
    const auditContent = fs.readFileSync(financialAuditDocPath, 'utf8');
    assert.match(
      auditContent,
      /Branch Protection Rules/i,
      'Must document branch protection requirements'
    );
    assert.match(
      auditContent,
      /Double-Entry Immutability/i,
      'Must document immutability principles'
    );
  });

  it('should provide automated CI governance workflow', () => {
    assert.strictEqual(fs.existsSync(ciWorkflowPath), true, '.github/workflows/ci.yml must exist');
    const content = fs.readFileSync(ciWorkflowPath, 'utf8');
    assert.match(
      content,
      /name: FinCore Financial Governance & CI Pipeline/i,
      'Should name CI workflow'
    );
    assert.match(content, /Secret Scan Protection/i, 'Should include secret scanning step');
  });

  it('should validate conventional commit regex parser', () => {
    const conventionalCommitRegex =
      /^(feat|fix|sec|audit|perf|docs|test|ci|refactor)(\([a-z0-9_-]+\))?:\s.+$/;
    assert.strictEqual(
      conventionalCommitRegex.test('feat(ledger): add multi-currency hold reservation'),
      true
    );
    assert.strictEqual(
      conventionalCommitRegex.test('fix(transfer): prevent race condition with row locking'),
      true
    );
    assert.strictEqual(
      conventionalCommitRegex.test('sec(auth): implement bcrypt password hashing'),
      true
    );
    assert.strictEqual(conventionalCommitRegex.test('invalid commit message without type'), false);
  });
});
