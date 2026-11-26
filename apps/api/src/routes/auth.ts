import type { Role } from '@fincore/shared';
import { Router, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { authenticateToken, requireAuth, requireRole } from '../middleware/auth.js';
import {
  generateAccessToken,
  generateConfirmationToken,
  generateMfaChallengeToken,
  generateMfaSecret,
  generateRefreshToken,
  hashPassword,
  logSecurityAudit,
  revokeAllUserSessions,
  revokeRefreshToken,
  rotateRefreshToken,
  storeRefreshToken,
  verifyMfaChallengeToken,
  verifyMfaCode,
  verifyPassword,
} from '../services/auth.js';
import { pool } from '../services/database.js';

export const authRouter = Router();

// Dedicated rate limiter for authentication endpoints (protection against brute-force)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 30,
  message: {
    error: 'Too Many Requests',
    message: 'Too many authentication attempts. Please try again after 15 minutes.',
    statusCode: 429,
  },
  standardHeaders: true,
  legacyHeaders: false,
});

// Zod validation schemas
const RegisterSchema = z.object({
  email: z.string().email(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters long')
    .regex(/[A-Za-z]/, 'Password must contain at least one letter')
    .regex(/[0-9]/, 'Password must contain at least one number'),
  fullName: z.string().min(1, 'Full name is required'),
  phone: z.string().optional(),
  role: z
    .enum([
      'customer',
      'support_agent',
      'operations_analyst',
      'finance_administrator',
      'platform_administrator',
      'operations',
    ])
    .optional()
    .default('customer'),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1, 'Password is required'),
});

const MfaChallengeSchema = z.object({
  mfaToken: z.string().min(1, 'MFA challenge token is required'),
  code: z.string().min(6, 'Verification code must be at least 6 characters'),
});

const MfaVerifySchema = z.object({
  code: z.string().min(6, 'Verification code is required'),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(1, 'Refresh token is required'),
});

const ReauthenticateSchema = z.object({
  password: z.string().optional(),
  code: z.string().optional(),
});

// Apply JWT token extraction across all auth routes
authRouter.use(authenticateToken);

/**
 * POST /api/auth/register
 * Customer & User registration with bcrypt hashing & automatic wallet provisioning
 */
authRouter.post('/register', authLimiter, async (req: Request, res: Response) => {
  const parseResult = RegisterSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Validation failed',
      details: parseResult.error.format(),
      statusCode: 400,
    });
    return;
  }

  const { email, password, fullName, phone, role } = parseResult.data;

  // Prevent unauthorized privilege escalation during public registration
  // Only an already-authenticated platform_administrator can register staff accounts
  let targetRole = role;
  if (role !== 'customer') {
    if (!req.user || req.user.role !== 'platform_administrator') {
      targetRole = 'customer'; // Safely downgrade to customer for public registration
    }
  }

  try {
    // Check if email or phone already exists
    const existing = await pool.query(
      `SELECT id, email, phone FROM users WHERE email = $1 OR (phone = $2 AND phone IS NOT NULL)`,
      [email, phone || null]
    );

    if (existing.rows.length > 0) {
      void logSecurityAudit({
        userId: null,
        action: 'registration_conflict',
        status: 'failure',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { email },
      });
      res.status(409).json({
        error: 'Conflict',
        message: 'An account with this email or phone number already exists',
        statusCode: 409,
      });
      return;
    }

    const passwordHash = await hashPassword(password);

    // Atomically create user and default primary wallet
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const userRes = await client.query(
        `INSERT INTO users (email, full_name, phone, role, password_hash, is_verified)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         RETURNING id, email, full_name, phone, role, is_verified, created_at`,
        [email, fullName, phone || null, targetRole, passwordHash]
      );

      const newUser = userRes.rows[0];

      // Automatically provision default USD wallet for customer
      const walletRes = await client.query(
        `INSERT INTO wallets (user_id, currency, balance, status)
         VALUES ($1, 'USD', 0.0000, 'active')
         RETURNING id, currency, balance, status`,
        [newUser.id]
      );

      await client.query('COMMIT');

      const userPayload = {
        id: newUser.id,
        email: newUser.email,
        role: newUser.role as Role,
        fullName: newUser.full_name || undefined,
      };

      const accessToken = generateAccessToken(userPayload);
      const refresh = generateRefreshToken(newUser.id);
      await storeRefreshToken(
        newUser.id,
        refresh.token,
        refresh.expiresAt,
        req.ip,
        req.headers['user-agent']
      );

      void logSecurityAudit({
        userId: newUser.id,
        action: 'register_success',
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { email: newUser.email, role: targetRole },
      });

      res.status(201).json({
        message: 'Account registered successfully',
        user: {
          id: newUser.id,
          email: newUser.email,
          fullName: newUser.full_name,
          phone: newUser.phone,
          role: newUser.role,
          isVerified: newUser.is_verified,
        },
        wallet: walletRes.rows[0],
        accessToken,
        refreshToken: refresh.token,
      });
    } catch (txErr) {
      await client.query('ROLLBACK');
      throw txErr;
    } finally {
      client.release();
    }
  } catch (err: unknown) {
    console.error('Registration error:', err);
    res
      .status(500)
      .json({ error: 'Internal Server Error', message: 'Failed to complete registration' });
  }
});

/**
 * POST /api/auth/login
 * User login with bcrypt verification & MFA challenge generation
 */
authRouter.post('/login', authLimiter, async (req: Request, res: Response) => {
  const parseResult = LoginSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Email and password are required',
      statusCode: 400,
    });
    return;
  }

  const { email, password } = parseResult.data;

  if (process.env.NODE_ENV === 'production' && email.endsWith('@fincore.internal')) {
    res.status(403).json({
      error: 'Forbidden',
      message: 'Demo persona accounts are restricted in production environments',
      statusCode: 403,
    });
    return;
  }

  try {
    const userRes = await pool.query(
      `SELECT id, email, full_name, phone, role, password_hash, mfa_enabled, is_verified
       FROM users
       WHERE email = $1`,
      [email]
    );

    if (userRes.rows.length === 0) {
      void logSecurityAudit({
        userId: null,
        action: 'login_failed',
        status: 'failure',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { email, reason: 'user_not_found' },
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password credentials',
        statusCode: 401,
      });
      return;
    }

    const user = userRes.rows[0];

    // If password_hash is not set or doesn't match
    if (!user.password_hash) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Password authentication not configured for this account',
        statusCode: 401,
      });
      return;
    }

    const matches = await verifyPassword(password, user.password_hash);
    if (!matches) {
      void logSecurityAudit({
        userId: user.id,
        action: 'login_failed',
        status: 'failure',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { email, reason: 'password_mismatch' },
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid email or password credentials',
        statusCode: 401,
      });
      return;
    }

    // Check MFA requirement
    if (user.mfa_enabled) {
      const mfaToken = generateMfaChallengeToken(user.id);
      void logSecurityAudit({
        userId: user.id,
        action: 'mfa_challenge_issued',
        status: 'success',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { email: user.email },
      });

      res.status(200).json({
        mfaRequired: true,
        mfaToken,
        userId: user.id,
        message: 'Two-factor authentication required. Please verify your OTP code.',
      });
      return;
    }

    // Issue standard tokens
    const userPayload = {
      id: user.id,
      email: user.email,
      role: user.role as Role,
      fullName: user.full_name || undefined,
    };

    const accessToken = generateAccessToken(userPayload);
    const refresh = generateRefreshToken(user.id);
    await storeRefreshToken(
      user.id,
      refresh.token,
      refresh.expiresAt,
      req.ip,
      req.headers['user-agent']
    );

    void logSecurityAudit({
      userId: user.id,
      action: 'login_success',
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { email: user.email, role: user.role },
    });

    res.status(200).json({
      message: 'Login successful',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        mfaEnabled: user.mfa_enabled,
        isVerified: user.is_verified,
      },
      accessToken,
      refreshToken: refresh.token,
    });
  } catch (err: unknown) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to process login' });
  }
});

/**
 * POST /api/auth/mfa/challenge
 * Complete MFA login with verification code or backup code
 */
authRouter.post('/mfa/challenge', authLimiter, async (req: Request, res: Response) => {
  const parseResult = MfaChallengeSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'MFA token and verification code are required',
      statusCode: 400,
    });
    return;
  }

  const { mfaToken, code } = parseResult.data;

  try {
    let challenge: { userId: string };
    try {
      challenge = verifyMfaChallengeToken(mfaToken);
    } catch (_err) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'MFA challenge token is invalid or has expired',
        statusCode: 401,
      });
      return;
    }

    const userRes = await pool.query(
      `SELECT id, email, full_name, role, mfa_secret, is_verified FROM users WHERE id = $1`,
      [challenge.userId]
    );

    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'User not found' });
      return;
    }

    const user = userRes.rows[0];
    const verification = await verifyMfaCode(user.id, user.mfa_secret || '', code);

    if (!verification.valid) {
      void logSecurityAudit({
        userId: user.id,
        action: 'mfa_verification_failed',
        status: 'failure',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: { email: user.email },
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Invalid MFA verification code',
        statusCode: 401,
      });
      return;
    }

    const userPayload = {
      id: user.id,
      email: user.email,
      role: user.role as Role,
      fullName: user.full_name || undefined,
    };

    const accessToken = generateAccessToken(userPayload);
    const refresh = generateRefreshToken(user.id);
    await storeRefreshToken(
      user.id,
      refresh.token,
      refresh.expiresAt,
      req.ip,
      req.headers['user-agent']
    );

    void logSecurityAudit({
      userId: user.id,
      action: 'mfa_login_success',
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { usedBackupCode: verification.usedBackupCode || false },
    });

    res.status(200).json({
      message: 'MFA verification successful',
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role,
        mfaEnabled: true,
        isVerified: user.is_verified,
      },
      accessToken,
      refreshToken: refresh.token,
    });
  } catch (err: unknown) {
    console.error('MFA challenge error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to verify MFA code' });
  }
});

/**
 * POST /api/auth/mfa/setup
 * Initiates MFA setup and returns secret, TOTP URL, and emergency backup codes
 */
authRouter.post(['/mfa/setup', '/mfa/generate'], requireAuth, async (req: Request, res: Response) => {
  try {
    const { secret, backupCodes, otpauthUrl } = generateMfaSecret();

    // Store unconfirmed secret and backup codes in user record
    await pool.query(
      `UPDATE users
       SET mfa_secret = $1, mfa_backup_codes = $2
       WHERE id = $3`,
      [secret, backupCodes, req.user!.id]
    );

    res.status(200).json({
      message: 'MFA setup initiated. Enter the verification code to activate.',
      secret,
      backupCodes,
      otpauthUrl,
      ...(process.env.NODE_ENV === 'production' ? {} : { demoCode: '123456' }),
    });
  } catch (err: unknown) {
    console.error('MFA setup error:', err);
    res
      .status(500)
      .json({ error: 'Internal Server Error', message: 'Failed to initiate MFA setup' });
  }
});

/**
 * POST /api/auth/mfa/verify
 * Confirms and activates MFA for user account
 */
authRouter.post('/mfa/verify', requireAuth, async (req: Request, res: Response) => {
  const parseResult = MfaVerifySchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Verification code is required',
      statusCode: 400,
    });
    return;
  }

  const { code } = parseResult.data;

  try {
    const userRes = await pool.query(`SELECT id, mfa_secret FROM users WHERE id = $1`, [
      req.user!.id,
    ]);

    if (userRes.rows.length === 0 || !userRes.rows[0].mfa_secret) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'MFA setup has not been initiated for this account',
        statusCode: 400,
      });
      return;
    }

    const { mfa_secret } = userRes.rows[0];
    const verification = await verifyMfaCode(req.user!.id, mfa_secret, code);

    if (!verification.valid) {
      res.status(400).json({
        error: 'Bad Request',
        message: 'Invalid verification code. Please check your authenticator and try again.',
        statusCode: 400,
      });
      return;
    }

    // Activate MFA
    await pool.query(`UPDATE users SET mfa_enabled = TRUE WHERE id = $1`, [req.user!.id]);

    void logSecurityAudit({
      userId: req.user!.id,
      action: 'mfa_enabled',
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(200).json({
      success: true,
      message: 'Two-factor authentication has been successfully enabled.',
    });
  } catch (err: unknown) {
    console.error('MFA activation error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to activate MFA' });
  }
});

/**
 * POST /api/auth/refresh
 * Refresh Token Rotation: invalidates old refresh token and issues new access + refresh pair
 */
authRouter.post('/refresh', async (req: Request, res: Response) => {
  const parseResult = RefreshSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({
      error: 'Bad Request',
      message: 'Refresh token is required',
      statusCode: 400,
    });
    return;
  }

  const { refreshToken } = parseResult.data;

  try {
    const rotated = await rotateRefreshToken(refreshToken, req.ip, req.headers['user-agent']);

    void logSecurityAudit({
      userId: rotated.user.id,
      action: 'token_refreshed',
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(200).json({
      message: 'Token refreshed successfully',
      accessToken: rotated.accessToken,
      refreshToken: rotated.refreshToken,
      user: rotated.user,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid refresh token';
    void logSecurityAudit({
      userId: null,
      action: 'token_refresh_failed',
      status: 'failure',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { error: message },
    });

    res.status(401).json({
      error: 'Unauthorized',
      message,
      statusCode: 401,
    });
  }
});

/**
 * POST /api/auth/logout
 * Revokes refresh token and ends session
 */
authRouter.post('/logout', async (req: Request, res: Response) => {
  const { refreshToken, all } = req.body || {};

  try {
    let revoked = false;
    if (refreshToken && typeof refreshToken === 'string') {
      revoked = await revokeRefreshToken(refreshToken);
    }

    if (all && req.user) {
      await revokeAllUserSessions(req.user.id);
      revoked = true;
    }

    void logSecurityAudit({
      userId: req.user?.id || null,
      action: 'logout',
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { revokedSession: revoked },
    });

    res.status(200).json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (err: unknown) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to logout' });
  }
});

/**
 * GET /api/auth/me
 * Retrieves current authenticated user profile, permissions, and active wallets
 */
authRouter.get('/me', requireAuth, async (req: Request, res: Response) => {
  try {
    const userRes = await pool.query(
      `SELECT id, email, full_name, phone, role, mfa_enabled, is_verified, created_at, updated_at
       FROM users
       WHERE id = $1`,
      [req.user!.id]
    );

    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'User not found' });
      return;
    }

    const user = userRes.rows[0];

    // Fetch user wallets
    const walletsRes = await pool.query(
      `SELECT id, currency, balance, held_balance, (balance - held_balance) as available_balance, status
       FROM wallets
       WHERE user_id = $1`,
      [user.id]
    );

    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        phone: user.phone,
        role: user.role,
        mfaEnabled: user.mfa_enabled,
        isVerified: user.is_verified,
        createdAt: user.created_at,
      },
      wallets: walletsRes.rows,
    });
  } catch (err: unknown) {
    console.error('Me lookup error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Failed to retrieve profile' });
  }
});

/**
 * POST /api/auth/reauthenticate
 * Step-Up Reauthentication for sensitive operations (transfers, administrative changes)
 */
authRouter.post('/reauthenticate', requireAuth, async (req: Request, res: Response) => {
  const parseResult = ReauthenticateSchema.safeParse(req.body);
  if (!parseResult.success) {
    res.status(400).json({ error: 'Bad Request', message: 'Password or MFA code is required' });
    return;
  }

  const { password, code } = parseResult.data;

  try {
    const userRes = await pool.query(
      `SELECT id, password_hash, mfa_secret, mfa_enabled FROM users WHERE id = $1`,
      [req.user!.id]
    );

    if (userRes.rows.length === 0) {
      res.status(404).json({ error: 'Not Found', message: 'User not found' });
      return;
    }

    const user = userRes.rows[0];
    let verified = false;

    if (password && user.password_hash) {
      verified = await verifyPassword(password, user.password_hash);
    } else if (code) {
      const mfaCheck = await verifyMfaCode(user.id, user.mfa_secret || '', code);
      verified = mfaCheck.valid;
    }

    if (!verified) {
      void logSecurityAudit({
        userId: user.id,
        action: 'reauthentication_failed',
        status: 'failure',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
      });
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Re-authentication failed: Invalid credentials',
        statusCode: 401,
      });
      return;
    }

    const confirmationToken = generateConfirmationToken(user.id);

    void logSecurityAudit({
      userId: user.id,
      action: 'reauthentication_success',
      status: 'success',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
    });

    res.status(200).json({
      message: 'Re-authentication successful',
      confirmationToken,
      validUntil: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    });
  } catch (err: unknown) {
    console.error('Re-authentication error:', err);
    res.status(500).json({ error: 'Internal Server Error', message: 'Re-authentication failed' });
  }
});

/**
 * GET /api/auth/audit-logs
 * Security & Access Audit Log Retrieval (Platform Admin, Operations, Finance Admin)
 */
authRouter.get(
  '/audit-logs',
  requireAuth,
  requireRole(
    'platform_administrator',
    'operations_analyst',
    'finance_administrator',
    'operations'
  ),
  async (req: Request, res: Response) => {
    const page = Math.max(1, parseInt(req.query.page as string, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string, 10) || 20));
    const offset = (page - 1) * limit;

    const action = req.query.action as string | undefined;
    const userId = req.query.userId as string | undefined;

    try {
      const conditions: string[] = [];
      const values: (string | number)[] = [];
      let paramIndex = 1;

      if (action) {
        conditions.push(`action = $${paramIndex++}`);
        values.push(action);
      }

      if (userId) {
        conditions.push(`user_id = $${paramIndex++}`);
        values.push(userId);
      }

      const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';

      const countRes = await pool.query(
        `SELECT COUNT(*) FROM security_audit_logs ${whereClause}`,
        values
      );
      const total = parseInt(countRes.rows[0].count, 10);

      const logsRes = await pool.query(
        `SELECT id, user_id, action, status, ip_address, user_agent, details, created_at
         FROM security_audit_logs
         ${whereClause}
         ORDER BY created_at DESC
         LIMIT $${paramIndex++} OFFSET $${paramIndex++}`,
        [...values, limit, offset]
      );

      res.status(200).json({
        auditLogs: logsRes.rows,
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      });
    } catch (err: unknown) {
      console.error('Audit logs query error:', err);
      res
        .status(500)
        .json({ error: 'Internal Server Error', message: 'Failed to retrieve audit logs' });
    }
  }
);
