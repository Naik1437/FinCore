-- FinCore Assessment 03: Double-Entry Ledger Database Migration
-- Adds holds, settlements, financial audit logs, wallet held balance, and ledger immutability trigger

-- 1. Ensure extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 2. Add held_balance to wallets for available balance tracking
ALTER TABLE wallets ADD COLUMN IF NOT EXISTS held_balance NUMERIC(18, 4) NOT NULL DEFAULT 0.0000;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallets_held_balance_nonnegative'
  ) THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_held_balance_nonnegative CHECK (held_balance >= 0);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'wallets_balance_exceeds_held'
  ) THEN
    ALTER TABLE wallets ADD CONSTRAINT wallets_balance_exceeds_held CHECK (balance >= held_balance);
  END IF;
END $$;

-- 3. Holds Table for reservation and available balance management
CREATE TABLE IF NOT EXISTS holds (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    transaction_id UUID REFERENCES transactions(id) ON DELETE SET NULL,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'released', 'settled', 'expired')),
    reason TEXT NOT NULL,
    metadata JSONB DEFAULT '{}',
    expires_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_holds_wallet_id ON holds(wallet_id);
CREATE INDEX IF NOT EXISTS idx_holds_status ON holds(status);
CREATE INDEX IF NOT EXISTS idx_holds_expires_at ON holds(expires_at);

-- 4. Settlements Table for multi-entity clearing and institutional settlement
CREATE TABLE IF NOT EXISTS settlements (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    source_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    destination_wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    amount NUMERIC(18, 4) NOT NULL CHECK (amount > 0),
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status VARCHAR(50) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'cleared', 'settled', 'failed')),
    clearing_institution VARCHAR(255) NOT NULL DEFAULT 'FinCore Automated Clearing House',
    reference_id VARCHAR(255),
    settled_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_settlements_transaction_id ON settlements(transaction_id);
CREATE INDEX IF NOT EXISTS idx_settlements_status ON settlements(status);

-- 5. Financial Audit Logs for compliance, reconciliation and event tracking
CREATE TABLE IF NOT EXISTS financial_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    entity_type VARCHAR(100) NOT NULL,
    entity_id UUID NOT NULL,
    action VARCHAR(50) NOT NULL,
    actor_id VARCHAR(255),
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_entity ON financial_audit_logs(entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_audit_created_at ON financial_audit_logs(created_at DESC);

-- 6. Strict Immutability Trigger for ledger_entries (Append-Only Enforcement)
CREATE OR REPLACE FUNCTION prevent_ledger_mutation()
RETURNS TRIGGER AS $$
BEGIN
    RAISE EXCEPTION 'ledger_entries table is strictly immutable and append-only. UPDATE and DELETE operations are prohibited.';
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_prevent_ledger_mutation ON ledger_entries;
CREATE TRIGGER trg_prevent_ledger_mutation
    BEFORE UPDATE OR DELETE ON ledger_entries
    FOR EACH ROW
    EXECUTE FUNCTION prevent_ledger_mutation();

-- 7. Apply updated_at triggers to new tables
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS update_holds_updated_at ON holds;
CREATE TRIGGER update_holds_updated_at
    BEFORE UPDATE ON holds
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_settlements_updated_at ON settlements;
CREATE TRIGGER update_settlements_updated_at
    BEFORE UPDATE ON settlements
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
