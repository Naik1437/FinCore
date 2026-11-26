DO $$
BEGIN
    IF to_regtype('public.dispute_status') IS NULL THEN
        CREATE TYPE dispute_status AS ENUM ('pending_review', 'under_investigation', 'resolved', 'rejected');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS beneficiaries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(255) NOT NULL,
    account_number VARCHAR(100) NOT NULL,
    routing_number VARCHAR(100),
    bank_name VARCHAR(255),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) DEFAULT 'active',
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS disputes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    reason VARCHAR(255) NOT NULL,
    details TEXT,
    status dispute_status DEFAULT 'pending_review',
    resolution_notes TEXT,
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_beneficiaries_user_id ON beneficiaries(user_id);
CREATE INDEX IF NOT EXISTS idx_disputes_transaction_id ON disputes(transaction_id);
CREATE INDEX IF NOT EXISTS idx_disputes_user_id ON disputes(user_id);
