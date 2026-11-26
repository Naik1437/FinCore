import 'dotenv/config';
import type { RedisClientType } from 'redis';
import { createClient } from 'redis';

export const redisClient: RedisClientType = createClient({
  socket: {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
  },
  password: process.env.REDIS_PASSWORD || undefined,
  database: parseInt(process.env.REDIS_DB || '0', 10),
});

redisClient.on('error', (err: Error) => {
  console.error('Redis Client Error:', err);
});

redisClient.on('connect', () => {
  console.log('Redis client connected');
});

redisClient.on('ready', () => {
  console.log('Redis client ready');
});

redisClient.on('reconnecting', () => {
  console.log('Redis client reconnecting...');
});

export const connectRedis = async () => {
  if (!redisClient.isOpen) {
    await redisClient.connect();
  }
  return redisClient;
};

export const disconnectRedis = async () => {
  if (redisClient.isOpen) {
    await redisClient.quit();
    console.log('Redis client disconnected');
  }
};

export const getCache = async <T>(key: string): Promise<T | null> => {
  const data = await redisClient.get(key);
  if (!data) return null;
  try {
    return JSON.parse(data) as T;
  } catch {
    return data as unknown as T;
  }
};

export const setCache = async (key: string, value: unknown, ttlSeconds?: number): Promise<void> => {
  const data = JSON.stringify(value);
  if (ttlSeconds) {
    await redisClient.setEx(key, ttlSeconds, data);
  } else {
    await redisClient.set(key, data);
  }
};

export const deleteCache = async (key: string): Promise<void> => {
  await redisClient.del(key);
};

export const existsCache = async (key: string): Promise<boolean> => {
  const result = await redisClient.exists(key);
  return result === 1;
};
