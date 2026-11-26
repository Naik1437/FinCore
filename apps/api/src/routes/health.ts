import type { Request, Response } from 'express';
import { Router } from 'express';
import { pool } from '../services/database.js';
import { connectRedis, redisClient } from '../services/redis.js';

export const healthRouter = Router();

healthRouter.get('/', async (_req: Request, res: Response) => {
  const checks = {
    status: 'healthy',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    environment: process.env.NODE_ENV || 'development',
    version: process.env.npm_package_version || '1.0.0',
    services: {
      database: 'unknown',
      redis: 'unknown',
    },
  };

  try {
    await pool.query('SELECT 1');
    checks.services.database = 'healthy';
  } catch (_error) {
    checks.services.database = 'unhealthy';
    checks.status = 'degraded';
  }

  try {
    if (!redisClient.isOpen) {
      await connectRedis();
    }
    await redisClient.ping();
    checks.services.redis = 'healthy';
  } catch (_error) {
    checks.services.redis = 'unhealthy';
    checks.status = 'degraded';
  }

  const statusCode = checks.status === 'healthy' ? 200 : 503;
  res.status(statusCode).json(checks);
});

healthRouter.get('/ready', async (_req: Request, res: Response) => {
  try {
    await pool.query('SELECT 1');
    if (!redisClient.isOpen) {
      await connectRedis();
    }
    await redisClient.ping();
    res.status(200).json({ status: 'ready' });
  } catch (_error) {
    res.status(503).json({ status: 'not ready', error: String(_error) });
  }
});

healthRouter.get('/live', (_req: Request, res: Response) => {
  res.status(200).json({ status: 'alive' });
});
