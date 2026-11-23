-- FinCore Database Initialization Script
-- This script runs automatically when the PostgreSQL container starts for the first time

-- Create extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Create enum types
CREATE TYPE wallet_status AS ENUM ('active', 'inactive', 'frozen', 'closed');
CREATE TYPE transaction_type AS ENUM ('deposit', 'withdrawal', 'transfer', 'payment');
CREATE TYPE transaction_status AS ENUM ('pending', 'processing', 'completed', 'failed', 'cancelled');
CREATE TYPE ledger_entry_type AS ENUM ('debit', 'credit');

-- Users table (minimal for wallet ownership)
CREATE TABLE IF NOT EXISTS users (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    email VARCHAR(255) UNIQUE NOT NULL,
    phone VARCHAR(50) UNIQUE,
    full_name VARCHAR(255),
    is_verified BOOLEAN DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Wallets table
CREATE TABLE IF NOT EXISTS wallets (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    balance NUMERIC(18, 4) NOT NULL DEFAULT 0.0000,
    status wallet_status NOT NULL DEFAULT 'active',
    version INTEGER NOT NULL DEFAULT 1,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT positive_balance CHECK (balance >= 0)
);

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    type transaction_type NOT NULL,
    amount NUMERIC(18, 4) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    status transaction_status NOT NULL DEFAULT 'pending',
    description TEXT,
    metadata JSONB DEFAULT '{}',
    idempotency_key VARCHAR(255) UNIQUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT positive_amount CHECK (amount > 0)
);

-- Ledger entries table (immutable audit trail)
CREATE TABLE IF NOT EXISTS ledger_entries (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    wallet_id UUID NOT NULL REFERENCES wallets(id) ON DELETE CASCADE,
    transaction_id UUID NOT NULL REFERENCES transactions(id) ON DELETE CASCADE,
    entry_type ledger_entry_type NOT NULL,
    amount NUMERIC(18, 4) NOT NULL,
    currency CHAR(3) NOT NULL DEFAULT 'USD',
    balance_after NUMERIC(18, 4) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT positive_amount CHECK (amount > 0)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_wallets_user_id ON wallets(user_id);
CREATE INDEX IF NOT EXISTS idx_wallets_status ON wallets(status);

CREATE INDEX IF NOT EXISTS idx_transactions_wallet_id ON transactions(wallet_id);
CREATE INDEX IF NOT EXISTS idx_transactions_type ON transactions(type);
CREATE INDEX IF NOT EXISTS idx_transactions_status ON transactions(status);
CREATE INDEX IF NOT EXISTS idx_transactions_created_at ON transactions(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transactions_idempotency_key ON transactions(idempotency_key);

CREATE INDEX IF NOT EXISTS idx_ledger_wallet_id ON ledger_entries(wallet_id);
CREATE INDEX IF NOT EXISTS idx_ledger_transaction_id ON ledger_entries(transaction_id);
CREATE INDEX IF NOT EXISTS idx_ledger_created_at ON ledger_entries(created_at DESC);

-- Updated_at trigger function
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

-- Apply updated_at triggers
DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_wallets_updated_at ON wallets;
CREATE TRIGGER update_wallets_updated_at
    BEFORE UPDATE ON wallets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_transactions_updated_at ON transactions;
CREATE TRIGGER update_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Function to get wallet balance with row-level locking
CREATE OR REPLACE FUNCTION get_wallet_balance(wallet_uuid UUID)
RETURNS NUMERIC(18, 4) AS $$
DECLARE
    bal NUMERIC(18, 4);
BEGIN
    SELECT balance INTO bal FROM wallets WHERE id = wallet_uuid FOR SHARE;
    RETURN bal;
END;
$$ LANGUAGE plpgsql;

-- Function to create ledger entry atomically
CREATE OR REPLACE FUNCTION create_ledger_entry(
    p_wallet_id UUID,
    p_transaction_id UUID,
    p_entry_type ledger_entry_type,
    p_amount NUMERIC(18, 4),
    p_currency CHAR(3),
    p_description TEXT
) RETURNS NUMERIC(18, 4) AS $$
DECLARE
    v_balance_after NUMERIC(18, 4);
BEGIN
    -- Lock the wallet row for update
    SELECT balance INTO v_balance_after FROM wallets WHERE id = p_wallet_id FOR UPDATE;
    
    -- Calculate new balance
    IF p_entry_type = 'credit' THEN
        v_balance_after := v_balance_after + p_amount;
    ELSE
        v_balance_after := v_balance_after - p_amount;
        IF v_balance_after < 0 THEN
            RAISE EXCEPTION 'Insufficient balance';
        END IF;
    END IF;
    
    -- Update wallet balance
    UPDATE wallets SET balance = v_balance_after, version = version + 1 WHERE id = p_wallet_id;
    
    -- Insert ledger entry
    INSERT INTO ledger_entries (wallet_id, transaction_id, entry_type, amount, currency, balance_after, description)
    VALUES (p_wallet_id, p_transaction_id, p_entry_type, p_amount, p_currency, v_balance_after, p_description);
    
    RETURN v_balance_after;
END;
$$ LANGUAGE plpgsql;

-- Grant permissions (adjust as needed for production)
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA public TO postgres;
GRANT ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public TO postgres;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO postgres;