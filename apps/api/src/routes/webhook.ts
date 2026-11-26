import type { Request, Response } from 'express';
import { Router } from 'express';
import { z } from 'zod';
import { pool } from '../services/database.js';
import { PaymentProviderService } from '../services/paymentProvider.js';

export const webhookRouter = Router();

const providerEvent = z
  .object({
    id: z.string().min(1).max(255),
    type: z.enum(['payment_intent.succeeded', 'payment_intent.payment_failed', 'charge.refunded']),
    data: z
      .object({
        object: z
          .object({
            id: z.string().min(1),
            amount: z
              .union([z.number(), z.string()])
              .refine(value => /^\d+(?:\.\d{1,4})?$/.test(String(value)) && Number(value) > 0),
            currency: z.string().regex(/^[A-Za-z]{3}$/),
          })
          .passthrough(),
      })
      .passthrough(),
  })
  .passthrough();

/**
 * Ingestion endpoint for signed payment provider webhooks
 */
webhookRouter.post('/payments', async (req: Request, res: Response) => {
  const signatureHeader =
    (req.headers['fincore-signature'] as string) || (req.headers['stripe-signature'] as string);

  // 1. Signature & Replay Verification
  const rawBody = (req as Request & { webhookRawBody?: string }).webhookRawBody;
  if (rawBody === undefined) return res.status(400).json({ error: 'Expected a JSON webhook body' });
  const verification = PaymentProviderService.verifySignature(rawBody, signatureHeader);

  if (!verification.valid) {
    return res.status(400).json({
      error: 'Invalid Webhook Signature',
      message: verification.reason,
      statusCode: 400,
    });
  }

  if (!providerEvent.safeParse(req.body).success) {
    return res.status(400).json({ error: 'Invalid provider event' });
  }

  // 2. Process event idempotently
  try {
    const result = await PaymentProviderService.processWebhookEvent(req.body);
    return res.status(200).json({
      received: true,
      duplicate: result.duplicate,
      eventId: result.eventId,
      eventType: result.eventType,
      message: result.message,
    });
  } catch (err: any) {
    console.error('WEBHOOK_PROCESS_ERROR:', err);
    return res.status(500).json({
      error: 'Webhook Processing Error',
      message: 'Unable to process provider event',
      statusCode: 500,
    });
  }
});

/**
 * Simulator endpoint for triggering signed provider webhooks in test/sandbox mode
 */
webhookRouter.post('/simulate', async (req: Request, res: Response) => {
  if (process.env.NODE_ENV === 'production') {
    return res.status(403).json({
      error: 'Forbidden',
      message: 'Webhook simulator is disabled in production environments',
      statusCode: 403,
    });
  }

  const { type, amount, currency, walletId, transactionId, failureReason, customerEmail } =
    req.body;

  if (!type || !amount) {
    return res.status(400).json({ error: 'Event type and amount are required' });
  }

  // Create simulated provider event
  const event = PaymentProviderService.createSimulatedEvent(type, {
    amount,
    currency,
    walletId,
    transactionId,
    failureReason,
    customerEmail,
  });

  // Sign payload
  const { header } = PaymentProviderService.signPayload(event);

  // Process via service
  try {
    const result = await PaymentProviderService.processWebhookEvent(event);
    return res.status(200).json({
      simulated: true,
      signatureHeader: header,
      event,
      result,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});

/**
 * Audit endpoint to inspect processed webhook events and deduplication status
 */
webhookRouter.get('/events', async (req: Request, res: Response) => {
  try {
    const limit = parseInt((req.query.limit as string) || '50', 10);
    const eventType = req.query.eventType as string;

    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (eventType) {
      conditions.push(`event_type = $${idx++}`);
      values.push(eventType);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pool.query(
      `SELECT * FROM webhook_events ${whereClause} ORDER BY created_at DESC LIMIT $${idx}`,
      [...values, limit]
    );

    return res.json({
      count: result.rows.length,
      events: result.rows,
    });
  } catch (err: any) {
    return res.status(500).json({ error: err.message });
  }
});
