import { Router } from 'express';
import {
  authenticateToken,
  requireAuth,
  requireRole,
  requireSensitiveActionConfirmation,
} from '../middleware/auth.js';
import { accountRouter } from './account.js';
import { authRouter } from './auth.js';
import { beneficiaryRouter } from './beneficiary.js';
import { disputeRouter } from './dispute.js';
import { holdRouter } from './hold.js';
import { ledgerRouter } from './ledger.js';
import { notificationRouter } from './notification.js';
import { paymentRouter } from './payment.js';
import { reportRouter } from './report.js';
import { settlementRouter } from './settlement.js';
import { statementRouter } from './statement.js';
import { transactionRouter } from './transaction.js';
import { walletRouter } from './wallet.js';
import { webhookRouter } from './webhook.js';

export const apiRouter = Router();

// Global token extraction & verification for all API routes
apiRouter.use(authenticateToken);

const finance = requireRole('finance_administrator', 'platform_administrator');
const operations = requireRole('operations', 'finance_administrator', 'platform_administrator');

apiRouter.use('/auth', authRouter);
apiRouter.use('/holds', requireAuth, finance);
apiRouter.use('/accounts', requireAuth, operations);
apiRouter.patch('/disputes/:id', requireAuth, operations);
apiRouter.get('/reports/summary', requireAuth, operations);
apiRouter.use('/reports/risk', requireAuth, operations);
apiRouter.post('/transactions', requireAuth, finance);
apiRouter.patch('/wallets/:id', requireAuth, finance);
apiRouter.patch('/wallets/:id/status', requireAuth, finance);
apiRouter.use('/transactions/queue', requireAuth, operations);
apiRouter.post(
  '/transactions/:id/refund',
  requireAuth,
  finance,
  requireSensitiveActionConfirmation
);
apiRouter.post(
  '/transactions/:id/reversal',
  requireAuth,
  finance,
  requireSensitiveActionConfirmation
);
apiRouter.post('/settlements', requireAuth, finance, requireSensitiveActionConfirmation);
apiRouter.get('/webhooks/events', requireAuth, operations);
apiRouter.post('/webhooks/simulate', requireAuth, operations);
apiRouter.post('/notifications/send', requireAuth, operations);
apiRouter.use('/accounts', requireAuth, accountRouter);
apiRouter.use('/wallets', requireAuth, walletRouter);
apiRouter.use('/transactions', requireAuth, transactionRouter);
apiRouter.use('/payments', requireAuth, paymentRouter);
apiRouter.use('/holds', requireAuth, holdRouter);
apiRouter.use('/settlements', requireAuth, operations, settlementRouter);
apiRouter.use('/ledger', requireAuth, operations, ledgerRouter);
apiRouter.use('/beneficiaries', requireAuth, beneficiaryRouter);
apiRouter.use('/disputes', requireAuth, disputeRouter);
apiRouter.use('/reports', requireAuth, reportRouter);
apiRouter.use('/statements', requireAuth, statementRouter);
apiRouter.use('/webhooks', webhookRouter);
apiRouter.use('/notifications', requireAuth, notificationRouter);

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'FinCore API',
    version: '1.0.0',
    description: 'Digital Wallet, Ledger & Payment Processing Platform',
    endpoints: {
      auth: '/api/auth',
      accounts: '/api/accounts',
      wallets: '/api/wallets',
      transactions: '/api/transactions',
      payments: '/api/payments',
      holds: '/api/holds',
      settlements: '/api/settlements',
      ledger: '/api/ledger',
      beneficiaries: '/api/beneficiaries',
      disputes: '/api/disputes',
      reports: '/api/reports',
      statements: '/api/statements',
      health: '/health',
    },
  });
});
