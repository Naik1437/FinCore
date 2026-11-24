import { Router } from 'express';
import { beneficiaryRouter } from './beneficiary.js';
import { disputeRouter } from './dispute.js';
import { ledgerRouter } from './ledger.js';
import { reportRouter } from './report.js';
import { transactionRouter } from './transaction.js';
import { walletRouter } from './wallet.js';

export const apiRouter = Router();

apiRouter.use('/wallets', walletRouter);
apiRouter.use('/transactions', transactionRouter);
apiRouter.use('/ledger', ledgerRouter);
apiRouter.use('/beneficiaries', beneficiaryRouter);
apiRouter.use('/disputes', disputeRouter);
apiRouter.use('/reports', reportRouter);

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'FinCore API',
    version: '1.0.0',
    description: 'Digital Wallet, Ledger & Payment Processing Platform',
    endpoints: {
      wallets: '/api/wallets',
      transactions: '/api/transactions',
      ledger: '/api/ledger',
      beneficiaries: '/api/beneficiaries',
      disputes: '/api/disputes',
      reports: '/api/reports',
      health: '/health',
    },
  });
});
