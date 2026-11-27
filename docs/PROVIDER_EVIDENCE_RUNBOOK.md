# Provider Evidence Runbook

This runbook separates real sandbox evidence from FinCore simulations.

## Stripe test mode

1. Supply an evaluator-owned `sk_test_` key and matching webhook secret through the
   runtime secret store; never place them in Git or screenshots.
2. Create and confirm a PaymentIntent using `pm_card_visa`.
3. Record the provider response ID, status, amount and currency with secrets redacted.
4. Deliver a real `payment_intent.succeeded` webhook to the public HTTPS endpoint
   using the provider dashboard or CLI forwarding tool.
5. Verify signature acceptance, provider-event ID persistence, idempotent replay, and
   exactly one balanced ledger posting.

Locally signed HMAC events and `/api/webhooks/simulate` prove only the internal
verification path; they do not prove provider delivery.

## Twilio trial

1. Supply evaluator-owned trial credentials and an approved destination number through
   the runtime secret store.
2. Send a permitted trial message using an approved Twilio test body/template.
3. Record HTTP status, message SID, provider status and final delivery callback, with
   phone numbers and credentials redacted.
4. Verify the internal notification record transitions from `queued` to its final
   provider-confirmed state, or document the provider rejection code.

An HTTP 201 or `queued` response alone is acceptance evidence, not delivery evidence.
