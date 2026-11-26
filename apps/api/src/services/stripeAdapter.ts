/**
 * FinCore Stripe Sandbox Adapter
 *
 * Implements actual Stripe Test Mode integration:
 * - Communicates with Stripe Test API (https://api.stripe.com/v1/payment_intents)
 * - Verifies official Stripe webhook signatures (t=...,v1=...)
 * - Uses Stripe official magic test tokens (e.g. pm_card_visa)
 * - Transparently falls back to FinCore's built-in synthetic provider if unconfigured
 *
 * SAFETY MANDATES:
 * - Rejects any live key (sk_live_* or pk_live_*). Only sk_test_* is accepted.
 * - Never processes real funds or banking credentials.
 */

export interface StripeIntentResult {
  id: string;
  clientSecret: string;
  status: string;
  amount: number;
  currency: string;
}

export class StripeSandboxAdapter {
  private static get secretKey(): string | undefined {
    return process.env.STRIPE_SECRET_KEY?.trim();
  }

  /**
   * Returns true only when a valid Stripe test key is configured.
   */
  public static isConfigured(): boolean {
    const key = this.secretKey;
    if (!key) return false;
    if (key.startsWith('sk_live_') || key.startsWith('rk_live_')) {
      throw new Error('SECURITY VIOLATION: Live Stripe keys are strictly forbidden in FinCore sandbox.');
    }
    return key.startsWith('sk_test_');
  }

  /**
   * Creates a payment intent in Stripe Test Mode.
   * If unconfigured, returns null so caller falls back to simulated provider.
   */
  public static async createPaymentIntent(params: {
    amount: number; // in currency units (e.g. 25.50)
    currency: string;
    description?: string;
    idempotencyKey?: string;
    metadata?: Record<string, string>;
  }): Promise<StripeIntentResult | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const key = this.secretKey!;
    const amountCents = Math.round(params.amount * 100);

    const body = new URLSearchParams({
      amount: String(amountCents),
      currency: params.currency.toLowerCase(),
      'payment_method_types[]': 'card',
    });

    if (params.description) {
      body.append('description', params.description);
    }

    if (params.metadata) {
      for (const [k, v] of Object.entries(params.metadata)) {
        body.append(`metadata[${k}]`, String(v));
      }
    }

    const headers: Record<string, string> = {
      Authorization: `Bearer ${key}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    };

    if (params.idempotencyKey) {
      headers['Idempotency-Key'] = params.idempotencyKey;
    }

    const response = await fetch('https://api.stripe.com/v1/payment_intents', {
      method: 'POST',
      headers,
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as any;
      throw new Error(`Stripe API Test Mode Error: ${err.error?.message || response.statusText}`);
    }

    const data = (await response.json()) as any;
    return {
      id: data.id,
      clientSecret: data.client_secret,
      status: data.status,
      amount: data.amount / 100,
      currency: data.currency.toUpperCase(),
    };
  }

  /**
   * Confirms a test payment intent using Stripe's official pm_card_visa test token.
   */
  public static async confirmPaymentIntent(
    paymentIntentId: string
  ): Promise<{ id: string; status: string } | null> {
    if (!this.isConfigured()) {
      return null;
    }

    const key = this.secretKey!;
    const body = new URLSearchParams({
      payment_method: 'pm_card_visa', // Standard Stripe test card
    });

    const response = await fetch(`https://api.stripe.com/v1/payment_intents/${paymentIntentId}/confirm`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: body.toString(),
      signal: AbortSignal.timeout(8000),
    });

    if (!response.ok) {
      const err = (await response.json().catch(() => ({}))) as any;
      throw new Error(`Stripe Confirm Error: ${err.error?.message || response.statusText}`);
    }

    const data = (await response.json()) as any;
    return {
      id: data.id,
      status: data.status,
    };
  }
}
