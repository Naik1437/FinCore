-- FinCore Assessment 07: Transfer Consistency Engine Migration
-- Adds transfer_jobs and dead_letter_queue tables for reliable async processing and dead-letter handling

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Transfer Jobs Table for async reliable transfer execution
CREATE TABLE IF NOT EXISTS transfer_jobs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    idempotency_key VARCHAR(255) UNIQUE,
    source_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    beneficiary_id UUID NOT NULL REFERENCES beneficiaries(id) ON DELETE CASCADE,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    description TEXT NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'completed', 'failed', 'dead_letter')),
    attempts INT NOT NULL DEFAULT 0,
    max_retries INT NOT NULL DEFAULT 3,
    last_error TEXT,
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transfer_jobs_status ON transfer_jobs(status);
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_idempotency ON transfer_jobs(idempotency_key);
CREATE INDEX IF NOT EXISTS idx_transfer_jobs_created_at ON transfer_jobs(created_at);

-- 2. Dead Letter Queue Table for failed transfer jobs requiring manual or replay adjudication
CREATE TABLE IF NOT EXISTS dead_letter_queue (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_id UUID REFERENCES transfer_jobs(id) ON DELETE CASCADE,
    idempotency_key VARCHAR(255),
    source_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    amount NUMERIC(18, 4) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    failure_reason TEXT NOT NULL,
    attempts INT NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    resolved BOOLEAN NOT NULL DEFAULT false,
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_dlq_job_id ON dead_letter_queue(job_id);
CREATE INDEX IF NOT EXISTS idx_dlq_resolved ON dead_letter_queue(resolved);
CREATE INDEX IF NOT EXISTS idx_dlq_created_at ON dead_letter_queue(created_at);
