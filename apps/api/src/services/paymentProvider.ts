import crypto from 'crypto';
import { formatFromUnits, getOrCreateSettlementWallet, toFixedUnits } from './consistencyEngine.js';
import { pool } from './database.js';
import { NotificationService } from './notificationService.js';
import { signingSecret } from './signingSecret.js';

export const DEFAULT_WEBHOOK_SECRET = signingSecret('WEBHOOK_SECRET');

export interface WebhookEventPayload {
  id: string;
  type:
    | 'payment_intent.succeeded'
    | 'payment_intent.payment_failed'
    | 'payment_intent.canceled'
    | 'charge.refunded';
  created: number;
  data: {
    object: {
      id: string;
      amount: number | string;
      currency: string;
      status: string;
      wallet_id?: string;
      transaction_id?: string;
      failure_reason?: string;
      customer_email?: string;
      customer_phone?: string;
      metadata?: Record<string, any>;
    };
  };
}

export class PaymentProviderService {
  /**
   * Generates a signed webhook signature header: t=123456789,v1=abc...
   */
  public static signPayload(
    payload: string | object,
    secret: string = DEFAULT_WEBHOOK_SECRET,
    timestamp?: number
  ): { header: string; timestamp: number; signature: string } {
    const t = timestamp ?? Math.floor(Date.now() / 1000);
    const rawPayload = typeof payload === 'string' ? payload : JSON.stringify(payload);
    const signedPayload = `${t}.${rawPayload}`;
    const signature = crypto.createHmac('sha256', secret).update(signedPayload).digest('hex');

    return {
      header: `t=${t},v1=${signature}`,
      timestamp: t,
      signature,
    };
  }

  /**
   * Verifies signed webhook with HMAC-SHA256 and replay protection (tolerance in seconds)
   */
  public static verifySignature(
    rawPayload: string | object,
    signatureHeader: string | undefined,
    secret: string = DEFAULT_WEBHOOK_SECRET,
    toleranceSeconds = 300
  ): { valid: boolean; reason?: string; timestamp?: number } {
    if (!signatureHeader) {
      return { valid: false, reason: 'Missing signature header' };
    }

    const payloadStr = typeof rawPayload === 'string' ? rawPayload : JSON.stringify(rawPayload);

    // Parse header: t=...,v1=...
    const elements = signatureHeader.split(',');
    let timestamp: number | null = null;
    let signature: string | null = null;

    for (const element of elements) {
      const [key, val] = element.trim().split('=');
      if (key === 't') {
        timestamp = parseInt(val, 10);
      } else if (key === 'v1') {
        signature = val;
      }
    }

    if (!timestamp || isNaN(timestamp) || !signature) {
      return { valid: false, reason: 'Malformed signature header scheme' };
    }

    // Replay attack defense: reject events older than tolerance or in the future
    const now = Math.floor(Date.now() / 1000);
    const age = now - timestamp;
    if (age > toleranceSeconds) {
      return {
        valid: false,
        reason: `Webhook timestamp expired (event age ${age}s exceeds ${toleranceSeconds}s tolerance)`,
        timestamp,
      };
    }
    if (age < -60) {
      return {
        valid: false,
        reason: 'Webhook timestamp is in the future',
        timestamp,
      };
    }

    // Compute expected signature
    const signedPayload = `${timestamp}.${payloadStr}`;
    const expectedSignature = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    // Constant-time comparison to prevent timing attacks
    const sigBuffer = Buffer.from(signature);
    const expectedBuffer = Buffer.from(expectedSignature);

    if (
      sigBuffer.length !== expectedBuffer.length ||
      !crypto.timingSafeEqual(sigBuffer, expectedBuffer)
    ) {
      return { valid: false, reason: 'Signature mismatch', timestamp };
    }

    return { valid: true, timestamp };
  }

  /**
   * Idempotently processes an incoming provider webhook event
   */
  public static async processWebhookEvent(event: WebhookEventPayload): Promise<{
    processed: boolean;
    duplicate: boolean;
    eventType: string;
    eventId: string;
    message: string;
  }> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      // 1. Deduplication check on provider event ID
      const existingRes = await client.query(
        'SELECT * FROM webhook_events WHERE event_id = $1 FOR UPDATE',
        [event.id]
      );

      const targetId = event.data?.object?.transaction_id || event.data?.object?.id;
      const isUuid = (val: string) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(val);

      if (existingRes.rows.length > 0) {
        const existingRecord = existingRes.rows[0];
        // If event was already successfully processed or failed, return duplicate
        if (existingRecord.status === 'processed' || existingRecord.status === 'failed' || !targetId) {
          await client.query('ROLLBACK');
          return {
            processed: true,
            duplicate: true,
            eventType: event.type,
            eventId: event.id,
            message: 'Webhook event already processed (idempotent deduplication)',
          };
        }

        // If previously received without mapped transaction, check if transaction is now available
        if (existingRecord.status === 'received' && event.type === 'payment_intent.succeeded') {
          const checkTxn = isUuid(targetId)
            ? await client.query(
                "SELECT id FROM transactions WHERE id = $1::uuid OR metadata->>'paymentIntentId' = $1::text",
                [targetId]
              )
            : await client.query(
                "SELECT id FROM transactions WHERE metadata->>'paymentIntentId' = $1::text",
                [targetId]
              );
          if (checkTxn.rows.length === 0) {
            // Still unmapped; safely retain without duplicating
            await client.query('ROLLBACK');
            return {
              processed: true,
              duplicate: true,
              eventType: event.type,
              eventId: event.id,
              message: 'Webhook event already processed (idempotent deduplication)',
            };
          }
          // Transaction now exists! Proceed to process and reconcile
        } else {
          await client.query('ROLLBACK');
          return {
            processed: true,
            duplicate: true,
            eventType: event.type,
            eventId: event.id,
            message: 'Webhook event already processed (idempotent deduplication)',
          };
        }
      }

      const obj = event.data.object;
      const amountUnits = toFixedUnits(obj.amount);
      const formattedAmount = formatFromUnits(amountUnits);
      const currency = (obj.currency || 'USD').trim().toUpperCase();
      let eventStatus = 'processed';
      let eventErrorMessage: string | null = null;

      // 2. Synchronize business state according to event type
      switch (event.type) {
        case 'payment_intent.succeeded': {
          // Identify associated transaction
          const txnRes = isUuid(targetId)
            ? await client.query(
                "SELECT * FROM transactions WHERE id = $1::uuid OR metadata->>'paymentIntentId' = $1::text FOR UPDATE",
                [targetId]
              )
            : await client.query(
                "SELECT * FROM transactions WHERE metadata->>'paymentIntentId' = $1::text FOR UPDATE",
                [targetId]
              );

          if (txnRes.rows.length > 0) {
            const txn = txnRes.rows[0];
            if (
              txn.type !== 'payment' ||
              txn.currency.trim() !== currency ||
              toFixedUnits(txn.amount) !== amountUnits
            ) {
              throw new Error('Provider event does not match the payment');
            }
            if (['pending', 'processing'].includes(txn.status)) {
              // Update transaction status
              await client.query(
                "UPDATE transactions SET status = 'completed', updated_at = NOW() WHERE id = $1",
                [txn.id]
              );

              // Update payer wallet balance
              await client.query(
                `UPDATE wallets 
                 SET balance = balance - $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
                 WHERE id = $2`,
                [formattedAmount, txn.wallet_id]
              );

              // Update settlement wallet
              const settlement = await getOrCreateSettlementWallet(client, currency);
              await client.query(
                `UPDATE wallets 
                 SET balance = balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
                 WHERE id = $2`,
                [formattedAmount, settlement.id]
              );

              // Balanced Double-Entry Ledger Entries
              await client.query(
                `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
                 VALUES ($1, $2, 'debit', $3::numeric(18, 4), $4, 
                         (SELECT balance FROM wallets WHERE id = $1), $5)`,
                [txn.wallet_id, txn.id, formattedAmount, currency, 'Provider webhook payment debit']
              );

              await client.query(
                `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
                 VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, 
                         (SELECT balance FROM wallets WHERE id = $1), $5)`,
                [
                  settlement.id,
                  txn.id,
                  formattedAmount,
                  currency,
                  'Provider webhook settlement credit',
                ]
              );
            }
          } else {
            // Unmapped payment event: retain in received status with reconciliation note so payment is never lost
            eventStatus = 'received';
            eventErrorMessage = 'Unmapped transaction: Payment event received without matching pending payment intent. Retained for ledger reconciliation.';
          }

          // Trigger email/SMS notification
          if (obj.customer_email) {
            await NotificationService.send({
              channel: 'email',
              recipient: obj.customer_email,
              template: 'payment_success',
              data: {
                amount: formattedAmount,
                currency,
                transactionId: targetId,
              },
            });
          }
          break;
        }

        case 'payment_intent.payment_failed': {
          const targetId = obj.transaction_id || obj.id;
          let failedUpdate;
          if (isUuid(targetId)) {
            failedUpdate = await client.query(
              `UPDATE transactions 
               SET status = 'failed', 
                   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('failureReason', $2::text), 
                   updated_at = NOW() 
               WHERE type = 'payment' AND status IN ('pending', 'processing') AND amount = $3::numeric AND currency = $4 AND (id = $1::uuid OR metadata->>'paymentIntentId' = $1::text)`,
              [
                targetId,
                obj.failure_reason || 'Provider payment authorization failed',
                formattedAmount,
                currency,
              ]
            );
          } else {
            failedUpdate = await client.query(
              `UPDATE transactions 
               SET status = 'failed', 
                   metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('failureReason', $2::text), 
                   updated_at = NOW() 
               WHERE type = 'payment' AND status IN ('pending', 'processing') AND amount = $3::numeric AND currency = $4 AND metadata->>'paymentIntentId' = $1::text`,
              [
                targetId,
                obj.failure_reason || 'Provider payment authorization failed',
                formattedAmount,
                currency,
              ]
            );
          }

          if (obj.customer_email) {
            await NotificationService.send({
              channel: 'email',
              recipient: obj.customer_email,
              template: 'payment_failed',
              data: {
                amount: formattedAmount,
                currency,
                reason: obj.failure_reason || 'Card declined by provider',
              },
            });
          }
          break;
        }

        case 'charge.refunded': {
          const targetId = obj.transaction_id || obj.id;
          const txnRes = isUuid(targetId)
            ? await client.query('SELECT * FROM transactions WHERE id = $1::uuid FOR UPDATE', [
                targetId,
              ])
            : await client.query(
                "SELECT * FROM transactions WHERE metadata->>'paymentIntentId' = $1::text FOR UPDATE",
                [targetId]
              );

          if (txnRes.rows.length > 0) {
            const txn = txnRes.rows[0];
            if (
              txn.type !== 'payment' ||
              txn.status !== 'completed' ||
              txn.currency.trim() !== currency ||
              toFixedUnits(txn.amount) !== amountUnits ||
              txn.metadata?.refunded
            ) {
              throw new Error('Provider refund does not match an unrefunded completed payment');
            }
            await client.query(
              "UPDATE transactions SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('refunded', true, 'refundId', $2::text), updated_at = NOW() WHERE id = $1",
              [txn.id, obj.id]
            );

            // Restore customer balance
            await client.query(
              `UPDATE wallets 
               SET balance = balance + $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
               WHERE id = $2`,
              [formattedAmount, txn.wallet_id]
            );

            // Compensating debit from settlement
            const settlement = await getOrCreateSettlementWallet(client, currency);
            await client.query(
              `UPDATE wallets 
               SET balance = balance - $1::numeric(18, 4), version = version + 1, updated_at = NOW() 
               WHERE id = $2`,
              [formattedAmount, settlement.id]
            );

            // Balanced refund ledger entries
            await client.query(
              `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
               VALUES ($1, $2, 'credit', $3::numeric(18, 4), $4, 
                       (SELECT balance FROM wallets WHERE id = $1), $5)`,
              [txn.wallet_id, txn.id, formattedAmount, currency, 'Provider webhook refund credit']
            );

            await client.query(
              `INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
               VALUES ($1, $2, 'debit', $3::numeric(18, 4), $4, 
                       (SELECT balance FROM wallets WHERE id = $1), $5)`,
              [
                settlement.id,
                txn.id,
                formattedAmount,
                currency,
                'Provider webhook refund settlement debit',
              ]
            );
          }

          if (obj.customer_email) {
            await NotificationService.send({
              channel: 'email',
              recipient: obj.customer_email,
              template: 'charge_refunded',
              data: {
                amount: formattedAmount,
                currency,
                refundId: obj.id,
              },
            });
          }
          break;
        }
      }

      // 3. Record event in webhook_events table
      await client.query(
        `INSERT INTO webhook_events (provider, event_id, event_type, payload, status, error_message)
         VALUES ('fincore_simulated_gateway', $1, $2, $3, $4, $5)
         ON CONFLICT (event_id) DO UPDATE 
         SET status = EXCLUDED.status, error_message = EXCLUDED.error_message, processed_at = NOW()`,
        [event.id, event.type, JSON.stringify(event), eventStatus, eventErrorMessage]
      );

      await client.query('COMMIT');

      return {
        processed: true,
        duplicate: false,
        eventType: event.type,
        eventId: event.id,
        message: 'Webhook event processed successfully and business state synchronized',
      };
    } catch (error: any) {
      await client.query('ROLLBACK');
      // If concurrent insert violated unique constraint on webhook_events_event_id_key, gracefully treat as duplicate
      if (error?.code === '23505' && error?.constraint === 'webhook_events_event_id_key') {
        return {
          processed: true,
          duplicate: true,
          eventType: event.type,
          eventId: event.id,
          message: 'Webhook event already processed (concurrent delivery deduplicated)',
        };
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Helper to create and simulate an event payload
   */
  public static createSimulatedEvent(
    type: WebhookEventPayload['type'],
    data: {
      amount: number | string;
      currency?: string;
      walletId?: string;
      transactionId?: string;
      failureReason?: string;
      customerEmail?: string;
      customerPhone?: string;
    }
  ): WebhookEventPayload {
    const eventId = `evt_sim_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    return {
      id: eventId,
      type,
      created: Math.floor(Date.now() / 1000),
      data: {
        object: {
          id: `pi_sim_${Date.now()}`,
          amount: data.amount,
          currency: data.currency || 'USD',
          status: type === 'payment_intent.succeeded' ? 'succeeded' : 'failed',
          wallet_id: data.walletId,
          transaction_id: data.transactionId,
          failure_reason: data.failureReason,
          customer_email: data.customerEmail || 'customer@fincore.internal',
          customer_phone: data.customerPhone,
        },
      },
    };
  }
}
