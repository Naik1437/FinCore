import cors from 'cors';
import 'dotenv/config';
import express, { type Application, type NextFunction, type Request, type Response } from 'express';
import rateLimit from 'express-rate-limit';
import helmet from 'helmet';
import morgan from 'morgan';
import { errorHandler } from './middleware/errorHandler.js';
import { requestLogger } from './middleware/requestLogger.js';
import { apiRouter } from './routes/api.js';
import { docsRouter } from './routes/docs.js';
import { healthRouter } from './routes/health.js';
import { connectRedis } from './services/redis.js';

const app: Application = express();
const PORT = process.env.PORT || 4000;

app.set('trust proxy', 1);

app.use(helmet());
app.use(
  cors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3000',
    credentials: true,
  })
);
app.use(morgan('combined'));
app.use(
  express.json({
    verify: (req, _res, buffer) => {
      if (req.url?.split('?')[0] === '/api/webhooks/payments') {
        (req as Request & { webhookRawBody?: string }).webhookRawBody = buffer.toString('utf8');
      }
    },
  })
);
app.use(express.urlencoded({ extended: true }));
app.use(requestLogger);

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: process.env.RATE_LIMIT_MAX ? parseInt(process.env.RATE_LIMIT_MAX, 10) : 1000,
  message: { error: 'Too many requests, please try again later.' },
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api/', limiter);

app.use('/health', healthRouter);
app.use('/docs', docsRouter);
app.use('/api', apiRouter);

app.use((req: Request, res: Response, _next: NextFunction) => {
  res.status(404).json({ error: 'Not Found', path: req.path });
});

app.use(errorHandler);

const isDirectExecution =
  process.argv[1]?.endsWith('index.ts') || process.argv[1]?.endsWith('index.js');
if (isDirectExecution && process.env.NODE_ENV !== 'test' && !process.env.FINCORE_TEST) {
  connectRedis().catch(err =>
    console.warn('Redis initial connection deferred:', (err as Error).message)
  );
  app.listen(PORT, () => {
    console.log(`🚀 FinCore API server running on http://localhost:${PORT}`);
    console.log(`📊 Health check: http://localhost:${PORT}/health`);
    console.log(`🔧 Environment: ${process.env.NODE_ENV || 'development'}`);
  });
}

export { app };
