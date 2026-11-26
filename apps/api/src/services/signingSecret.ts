import { randomBytes } from 'node:crypto';

export function signingSecret(name: string): string {
  const value = process.env[name];
  if (process.env.NODE_ENV === 'production') {
    if (!value || value.length < 32 || /placeholder|fincore|change.?me/i.test(value)) {
      throw new Error(`Configure a strong, unique ${name} for production`);
    }
    return value;
  }
  return value || randomBytes(32).toString('hex');
}
