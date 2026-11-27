import { pool } from './database.js';

export interface SendNotificationParams {
  userId?: string;
  channel: 'email' | 'sms';
  recipient: string;
  template:
    | 'payment_success'
    | 'payment_failed'
    | 'transfer_receipt'
    | 'charge_refunded'
    | 'security_alert';
  data: Record<string, any>;
  subject?: string;
  maxRetries?: number;
  simulateFailure?: boolean;
}

export interface NotificationRecord {
  id: string;
  userId?: string;
  channel: 'email' | 'sms';
  recipient: string;
  subject?: string;
  body: string;
  template: string;
  status: 'delivered' | 'failed' | 'queued';
  attempts: number;
  metadata: Record<string, any>;
  createdAt: string;
}

export class NotificationService {
  /**
   * Generates formatted message body from template and parameters
   */
  public static renderTemplate(
    template: SendNotificationParams['template'],
    data: Record<string, any>
  ): { subject: string; body: string } {
    switch (template) {
      case 'payment_success':
        return {
          subject: 'FinCore Payment Receipt: Succeeded',
          body: `Your payment of ${data.amount ?? '0.00'} ${data.currency ?? 'USD'} was successfully completed. Transaction ID: ${data.transactionId ?? 'N/A'}.`,
        };
      case 'payment_failed':
        return {
          subject: 'FinCore Payment Notice: Failed',
          body: `Your payment of ${data.amount ?? '0.00'} ${data.currency ?? 'USD'} could not be processed. Reason: ${data.reason ?? 'Declined by issuer'}.`,
        };
      case 'transfer_receipt':
        return {
          subject: 'FinCore Transfer Confirmation',
          body: `Transfer of ${data.amount ?? '0.00'} ${data.currency ?? 'USD'} to ${data.beneficiaryName ?? 'Recipient'} is complete. Receipt ID: ${data.receiptId ?? 'N/A'}.`,
        };
      case 'charge_refunded':
        return {
          subject: 'FinCore Refund Processed',
          body: `A refund of ${data.amount ?? '0.00'} ${data.currency ?? 'USD'} has been credited. Refund ID: ${data.refundId ?? 'N/A'}.`,
        };
      case 'security_alert':
        return {
          subject: 'FinCore Security Notification',
          body: `Security event detected on your account: ${data.eventDescription ?? 'Unusual activity'}. If this was not you, please contact support immediately.`,
        };
      default:
        return {
          subject: 'FinCore Notification',
          body: JSON.stringify(data),
        };
    }
  }

  /**
   * Dispatches a notification through the simulated sandbox email/SMS channel with retry logic
   */
  public static async send(params: SendNotificationParams): Promise<NotificationRecord> {
    const {
      userId,
      channel,
      recipient,
      template,
      data,
      maxRetries = 3,
      simulateFailure = false,
    } = params;

    const rendered = this.renderTemplate(template, data);
    const subject = params.subject || rendered.subject;
    const body = rendered.body;

    let attempts = 0;
    let status: 'queued' | 'delivered' | 'failed' = 'delivered';

    // Simulate transmission attempts & retries
    while (attempts < maxRetries) {
      attempts++;
      if (simulateFailure && attempts < maxRetries) {
        // Retry backoff simulation
        continue;
      }
      if (simulateFailure && attempts >= maxRetries) {
        status = 'failed';
        break;
      }
      status = 'delivered';
      break;
    }

    // 1. Mailpit Email Sandbox Dispatch (Zero-credential local sandbox)
    if (channel === 'email' && status === 'delivered') {
      try {
        const mailpitUrl = process.env.MAILPIT_URL || 'http://localhost:8025';
        await fetch(`${mailpitUrl}/api/v1/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            From: { Email: 'notifications@fincore.internal', Name: 'FinCore Platform' },
            To: [{ Email: recipient }],
            Subject: subject,
            Text: body,
          }),
          signal: AbortSignal.timeout(1000),
        }).catch(() => {});
      } catch (_e) {
        // Graceful fallback to internal DB persistence
      }
    }

    // 2. Twilio SMS Sandbox Dispatch (Official test credentials & magic numbers)
    const providerMetadata: Record<string, any> = { ...data };
    const twilioSid = process.env.TWILIO_ACCOUNT_SID?.trim();
    const twilioAuth = process.env.TWILIO_AUTH_TOKEN?.trim();
    if (channel === 'sms' && status === 'delivered' && twilioSid && twilioAuth) {
      try {
        const auth = Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');
        const fromNumber = process.env.TWILIO_FROM_PHONE || '+15005550006'; // Official Twilio magic test number
        const trialTemplate =
          (typeof data.twilioTrialTemplate === 'string' && data.twilioTrialTemplate.trim()) ||
          process.env.TWILIO_TRIAL_TEMPLATE?.trim() ||
          '';
        const smsBody = trialTemplate || body;
        const smsParams = new URLSearchParams({
          From: fromNumber,
          To: recipient,
          Body: smsBody,
        });
        const twilioRes = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`,
          {
            method: 'POST',
            headers: {
              Authorization: `Basic ${auth}`,
              'Content-Type': 'application/x-www-form-urlencoded',
            },
            body: smsParams.toString(),
            signal: AbortSignal.timeout(5000),
          }
        );
        const twilioJson = (await twilioRes.json().catch(() => ({}))) as Record<string, any>;
        providerMetadata.provider = trialTemplate ? 'twilio_trial' : 'twilio_sandbox';
        if (trialTemplate) {
          providerMetadata.twilioTrialTemplate = trialTemplate;
        }
        if (twilioRes.ok && twilioJson.sid) {
          providerMetadata.twilioHttpStatus = twilioRes.status;
          providerMetadata.twilioMessageSid = twilioJson.sid;
          providerMetadata.twilioStatus = twilioJson.status;
          // Do not mark queued/accepted/sent as delivered without explicit delivery confirmation
          status = twilioJson.status === 'delivered' ? 'delivered' : 'queued';
        } else {
          status = 'failed';
          providerMetadata.twilioHttpStatus = twilioRes.status;
          providerMetadata.twilioErrorCode = twilioJson.code;
          providerMetadata.twilioErrorMessage = twilioJson.message || `HTTP ${twilioRes.status}`;
        }
      } catch (err: unknown) {
        status = 'failed';
        providerMetadata.provider = 'twilio_sandbox';
        providerMetadata.twilioErrorMessage =
          err instanceof Error ? err.message : 'Twilio sandbox request failed';
      }
    }

    const res = await pool.query(
      `INSERT INTO notifications (user_id, channel, recipient, subject, body, template, status, attempts, metadata)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING *`,
      [
        userId || null,
        channel,
        recipient,
        subject,
        body,
        template,
        status,
        attempts,
        JSON.stringify(providerMetadata),
      ]
    );

    const row = res.rows[0];
    return {
      id: row.id,
      userId: row.user_id,
      channel: row.channel,
      recipient: row.recipient,
      subject: row.subject,
      body: row.body,
      template: row.template,
      status: row.status,
      attempts: row.attempts,
      metadata: row.metadata,
      createdAt: row.created_at,
    };
  }

  /**
   * Queries delivered and failed notifications log
   */
  public static async list(filters?: {
    userId?: string;
    channel?: string;
    status?: string;
    limit?: number;
  }): Promise<NotificationRecord[]> {
    const conditions: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (filters?.userId) {
      conditions.push(`user_id = $${idx++}`);
      values.push(filters.userId);
    }
    if (filters?.channel) {
      conditions.push(`channel = $${idx++}`);
      values.push(filters.channel);
    }
    if (filters?.status) {
      conditions.push(`status = $${idx++}`);
      values.push(filters.status);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = filters?.limit || 50;

    const res = await pool.query(
      `SELECT * FROM notifications ${whereClause} ORDER BY created_at DESC LIMIT $${idx}`,
      [...values, limit]
    );

    return res.rows.map(r => ({
      id: r.id,
      userId: r.user_id,
      channel: r.channel,
      recipient: r.recipient,
      subject: r.subject,
      body: r.body,
      template: r.template,
      status: r.status,
      attempts: r.attempts,
      metadata: r.metadata,
      createdAt: r.created_at,
    }));
  }
}
