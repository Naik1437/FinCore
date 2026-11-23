import { Router } from 'express';
import { ledgerRouter } from './ledger.js';
import { transactionRouter } from './transaction.js';
import { walletRouter } from './wallet.js';

export const apiRouter = Router();

apiRouter.use('/wallets', walletRouter);
apiRouter.use('/transactions', transactionRouter);
apiRouter.use('/ledger', ledgerRouter);

apiRouter.get('/', (_req, res) => {
  res.json({
    name: 'FinCore API',
    version: '1.0.0',
    description: 'Digital Wallet, Ledger & Payment Processing Platform',
    endpoints: {
      wallets: '/api/wallets',
      transactions: '/api/transactions',
      ledger: '/api/ledger',
      health: '/health',
    },
  });
});
