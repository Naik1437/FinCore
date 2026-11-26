import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { describe, it } from 'node:test';

describe('Assessment 09 — Containerized Stack Tests', () => {
  const rootDir = path.resolve(__dirname, '../../../../');
  const apiDockerfilePath = path.join(rootDir, 'apps/api/Dockerfile');
  const webDockerfilePath = path.join(rootDir, 'apps/web/Dockerfile');
  const analyticsDockerfilePath = path.join(rootDir, 'services/analytics/Dockerfile');
  const dockerComposePath = path.join(rootDir, 'docker-compose.yml');
  const dockerignorePath = path.join(rootDir, '.dockerignore');
  const envExamplePath = path.join(rootDir, '.env.example');

  it('should have a comprehensive .dockerignore file', () => {
    assert.strictEqual(fs.existsSync(dockerignorePath), true, '.dockerignore must exist at root');
    const content = fs.readFileSync(dockerignorePath, 'utf8');
    assert.match(content, /node_modules/, 'Should ignore node_modules');
    assert.match(content, /\.git/, 'Should ignore .git');
    assert.match(content, /\.env\*/, 'Should ignore secret .env files');
    assert.match(content, /__pycache__/, 'Should ignore python cache');
  });

  it('should define a production multi-stage Dockerfile for API', () => {
    assert.strictEqual(fs.existsSync(apiDockerfilePath), true, 'apps/api/Dockerfile must exist');
    const content = fs.readFileSync(apiDockerfilePath, 'utf8');
    assert.match(content, /FROM node:.* AS builder/i, 'Must have builder stage');
    assert.match(content, /FROM node:.* AS runner/i, 'Must have runner stage');
    assert.match(content, /USER node/, 'Must run as non-root user (node)');
    assert.match(content, /HEALTHCHECK/, 'Must configure container healthcheck');
    assert.match(content, /EXPOSE 4000/, 'Must expose port 4000');
  });

  it('should define a production multi-stage Dockerfile for Web frontend', () => {
    assert.strictEqual(fs.existsSync(webDockerfilePath), true, 'apps/web/Dockerfile must exist');
    const content = fs.readFileSync(webDockerfilePath, 'utf8');
    assert.match(content, /FROM node:.* AS builder/i, 'Must have builder stage');
    assert.match(content, /FROM node:.* AS runner/i, 'Must have runner stage');
    assert.match(content, /USER node/, 'Must run as non-root user (node)');
    assert.match(content, /HEALTHCHECK/, 'Must configure container healthcheck');
    assert.match(content, /EXPOSE 3000/, 'Must expose port 3000');
  });

  it('should define a production multi-stage Dockerfile for FastAPI Analytics', () => {
    assert.strictEqual(
      fs.existsSync(analyticsDockerfilePath),
      true,
      'services/analytics/Dockerfile must exist'
    );
    const content = fs.readFileSync(analyticsDockerfilePath, 'utf8');
    assert.match(content, /FROM python:.* AS builder/i, 'Must have builder stage');
    assert.match(content, /FROM python:.* AS runner/i, 'Must have runner stage');
    assert.match(content, /useradd.*fincore/i, 'Must configure non-root user');
    assert.match(content, /USER fincore/, 'Must switch to non-root fincore user');
    assert.match(content, /HEALTHCHECK/, 'Must configure container healthcheck');
    assert.match(content, /EXPOSE 8000/, 'Must expose port 8000');
  });

  it('should configure complete Docker Compose orchestration with dependencies and health checks', () => {
    assert.strictEqual(fs.existsSync(dockerComposePath), true, 'docker-compose.yml must exist');
    const content = fs.readFileSync(dockerComposePath, 'utf8');

    // Services defined
    assert.match(content, /postgres:/, 'PostgreSQL service defined');
    assert.match(content, /redis:/, 'Redis service defined');
    assert.match(content, /analytics:/, 'FastAPI Analytics service defined');
    assert.match(content, /api:/, 'Express API service defined');
    assert.match(content, /web:/, 'Web frontend service defined');

    // Healthchecks and dependencies
    assert.match(
      content,
      /condition: service_healthy/,
      'Should declare healthy condition dependencies'
    );
    assert.match(content, /restart: unless-stopped/, 'Should declare reliable restart policy');
    assert.match(content, /fincore-network/, 'Should link services through custom network');
    assert.match(content, /fincore-postgres-data/, 'Should declare persistent volume for postgres');
    assert.match(content, /fincore-redis-data/, 'Should declare persistent volume for redis');

    // Port collision avoidance / internal network isolation
    assert.ok(
      !/ports:\s*-\s*"8000:8000"/.test(content),
      'Analytics internal service must avoid host port 8000 collision'
    );
  });

  it('should provide comprehensive environment template in .env.example', () => {
    assert.strictEqual(fs.existsSync(envExamplePath), true, '.env.example must exist');
    const content = fs.readFileSync(envExamplePath, 'utf8');
    assert.match(content, /DB_HOST=/, 'Contains DB_HOST');
    assert.match(content, /REDIS_HOST=/, 'Contains REDIS_HOST');
    assert.match(content, /ANALYTICS_URL=/, 'Contains ANALYTICS_URL');
    assert.match(content, /JWT_SECRET=/, 'Contains JWT_SECRET');
  });
});
