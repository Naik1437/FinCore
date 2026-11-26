import type { Role } from '@fincore/shared';
import type { NextFunction, Request, Response } from 'express';
import {
  logSecurityAudit,
  verifyAccessToken,
  verifyConfirmationToken,
  type UserPayload,
} from '../services/auth.js';

// Extend Express Request with optional authenticated user
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserPayload;
    }
  }
}

/**
 * Parses and verifies JWT Bearer token if provided in Authorization header.
 * Attaches req.user on valid token.
 * Returns 401 Unauthorized on invalid/expired token.
 * Leaves req.user undefined if no token header was provided.
 */
export function authenticateToken(req: Request, res: Response, next: NextFunction): void {
  // Public credential/session-establishment endpoints must ignore stale/expired Bearer headers
  if (
    req.method === 'POST' &&
    (req.path === '/auth/login' ||
      req.path === '/login' ||
      req.path === '/auth/mfa/challenge' ||
      req.path === '/mfa/challenge' ||
      req.path === '/auth/refresh' ||
      req.path === '/refresh')
  ) {
    return next();
  }

  const authHeader = req.headers.authorization || req.headers['x-access-token'];
  if (!authHeader) {
    return next();
  }

  const token =
    typeof authHeader === 'string' && authHeader.startsWith('Bearer ')
      ? authHeader.slice(7).trim()
      : typeof authHeader === 'string'
        ? authHeader.trim()
        : null;

  if (!token) {
    return next();
  }

  try {
    const user = verifyAccessToken(token);
    req.user = user;
    return next();
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Invalid token';
    void logSecurityAudit({
      userId: null,
      action: 'invalid_access_token',
      status: 'blocked',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { path: req.path, error: message },
    });
    res.status(401).json({
      error: 'Unauthorized',
      message: `Invalid or expired access token: ${message}`,
      statusCode: 401,
    });
  }
}

/**
 * Requires an authenticated user session. Returns 401 if unauthenticated.
 */
export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  if (!req.user) {
    void logSecurityAudit({
      userId: null,
      action: 'unauthenticated_access_attempt',
      status: 'blocked',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { path: req.path },
    });
    res.status(401).json({
      error: 'Unauthorized',
      message: 'Authentication required. Please provide a valid Bearer token.',
      statusCode: 401,
    });
    return;
  }
  next();
}

/**
 * Role-Based Access Control (RBAC) middleware.
 * Verifies that the authenticated user possesses one of the allowed roles.
 */
export function requireRole(...allowedRoles: (Role | 'operations')[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({
        error: 'Unauthorized',
        message: 'Authentication required for role verification',
        statusCode: 401,
      });
      return;
    }

    const userRole = req.user.role;
    // Normalize 'operations' to 'operations_analyst'
    const normalizedUserRole = userRole === 'operations' ? 'operations_analyst' : userRole;
    const normalizedAllowed = allowedRoles.map(r =>
      r === 'operations' ? 'operations_analyst' : r
    );

    if (!normalizedAllowed.includes(normalizedUserRole)) {
      void logSecurityAudit({
        userId: req.user.id,
        action: 'privilege_escalation_attempt',
        status: 'blocked',
        ipAddress: req.ip,
        userAgent: req.headers['user-agent'],
        details: {
          path: req.path,
          method: req.method,
          userRole,
          allowedRoles,
        },
      });

      res.status(403).json({
        error: 'Forbidden',
        message: `Insufficient role permissions. Required: [${allowedRoles.join(', ')}], Current: ${userRole}`,
        statusCode: 403,
      });
      return;
    }

    next();
  };
}

/**
 * Resource Ownership & Object-Level Authorization middleware.
 * Ensures customers can only access their own wallets, transfers, and transactions.
 * Administrative/support staff bypass ownership restrictions.
 */
export function requireResourceOwnership(
  getOwnerId: (req: Request) => Promise<string | null | undefined>
) {
  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    if (!req.user) {
      return requireAuth(req, res, next);
    }

    // Administrative roles bypass customer resource ownership check
    const administrativeRoles: (Role | 'operations')[] = [
      'platform_administrator',
      'finance_administrator',
      'operations_analyst',
      'support_agent',
      'operations',
    ];

    if (administrativeRoles.includes(req.user.role)) {
      return next();
    }

    try {
      const ownerId = await getOwnerId(req);
      if (ownerId && ownerId !== req.user.id) {
        void logSecurityAudit({
          userId: req.user.id,
          action: 'cross_account_resource_access_attempt',
          status: 'blocked',
          ipAddress: req.ip,
          userAgent: req.headers['user-agent'],
          details: {
            path: req.path,
            method: req.method,
            targetedOwnerId: ownerId,
          },
        });

        res.status(403).json({
          error: 'Forbidden',
          message: 'Access denied: You do not own this financial resource.',
          statusCode: 403,
        });
        return;
      }
      next();
    } catch (err: unknown) {
      next(err);
    }
  };
}

/**
 * Step-Up Reauthentication Guard for Sensitive Actions.
 * Verifies X-Action-Confirmation header.
 */
export function requireSensitiveActionConfirmation(
  req: Request,
  res: Response,
  next: NextFunction
): void {
  const confirmationHeader = req.headers['x-action-confirmation'];
  if (!confirmationHeader || typeof confirmationHeader !== 'string') {
    void logSecurityAudit({
      userId: req.user?.id || null,
      action: 'sensitive_action_missing_confirmation',
      status: 'blocked',
      ipAddress: req.ip,
      userAgent: req.headers['user-agent'],
      details: { path: req.path, method: req.method },
    });

    res.status(403).json({
      error: 'Reauthentication Required',
      message:
        'This sensitive financial action requires step-up reauthentication (X-Action-Confirmation).',
      statusCode: 403,
    });
    return;
  }

  try {
    const verified = verifyConfirmationToken(confirmationHeader);
    if (req.user && verified.userId !== req.user.id) {
      res.status(403).json({
        error: 'Forbidden',
        message: 'Confirmation token does not match authenticated user.',
        statusCode: 403,
      });
      return;
    }
    next();
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : 'Invalid confirmation token';
    res.status(403).json({
      error: 'Forbidden',
      message: `Invalid or expired confirmation token: ${msg}`,
      statusCode: 403,
    });
  }
}
