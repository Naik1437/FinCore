-- FinCore Assessment 04: Financial Identity & Authorization Schema Migration
-- Idempotent, non-destructive migration

-- 1. Extend users table with authentication, authorization, and MFA fields
ALTER TABLE users ADD COLUMN IF NOT EXISTS password_hash VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS role VARCHAR(50) NOT NULL DEFAULT 'customer';
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_secret VARCHAR(255);
ALTER TABLE users ADD COLUMN IF NOT EXISTS mfa_backup_codes TEXT[] DEFAULT '{}';

-- Migrate existing 'operations' role to 'operations_analyst'
UPDATE users SET role = 'operations_analyst' WHERE role = 'operations';

-- Enforce role check constraint (supporting standard 5 roles + operations alias)
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check'
    ) THEN
        ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN ('customer', 'support_agent', 'operations_analyst', 'finance_administrator', 'platform_administrator', 'operations'));
    END IF;
END $$;

-- Set default password hash for any existing users without a password
UPDATE users 
SET password_hash = '$2b$10$y2CTi/q1VXVHuf5uZsmIce8SE1.mA05jAeIirfzAOr7aIRN2zXF1S' 
WHERE password_hash IS NULL;

-- 2. Create refresh_tokens table for session management & rotation
CREATE TABLE IF NOT EXISTS refresh_tokens (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash VARCHAR(64) NOT NULL UNIQUE,
    is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
    expires_at TIMESTAMPTZ NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token_hash ON refresh_tokens(token_hash);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- 3. Create security_audit_logs table for authentication events & access violation tracking
CREATE TABLE IF NOT EXISTS security_audit_logs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    action VARCHAR(100) NOT NULL,
    status VARCHAR(20) NOT NULL,
    ip_address VARCHAR(45),
    user_agent TEXT,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_security_audit_logs_user ON security_audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_action ON security_audit_logs(action);
CREATE INDEX IF NOT EXISTS idx_security_audit_logs_created_at ON security_audit_logs(created_at);

-- 4. Seed role users if not already present
INSERT INTO users (id, email, full_name, phone, role, password_hash, is_verified)
VALUES
    ('a0000000-0000-0000-0000-000000000001', 'customer@fincore.internal', 'Customer User', '+15550000001', 'customer', '$2b$10$y2CTi/q1VXVHuf5uZsmIce8SE1.mA05jAeIirfzAOr7aIRN2zXF1S', TRUE),
    ('a0000000-0000-0000-0000-000000000002', 'support@fincore.internal', 'Support Agent', '+15550000002', 'support_agent', '$2b$10$y2CTi/q1VXVHuf5uZsmIce8SE1.mA05jAeIirfzAOr7aIRN2zXF1S', TRUE),
    ('a0000000-0000-0000-0000-000000000003', 'operations@fincore.internal', 'Operations Analyst', '+15550000003', 'operations_analyst', '$2b$10$y2CTi/q1VXVHuf5uZsmIce8SE1.mA05jAeIirfzAOr7aIRN2zXF1S', TRUE),
    ('a0000000-0000-0000-0000-000000000004', 'finance.admin@fincore.internal', 'Finance Administrator', '+15550000004', 'finance_administrator', '$2b$10$y2CTi/q1VXVHuf5uZsmIce8SE1.mA05jAeIirfzAOr7aIRN2zXF1S', TRUE),
    ('a0000000-0000-0000-0000-000000000005', 'platform.admin@fincore.internal', 'Platform Administrator', '+15550000005', 'platform_administrator', '$2b$10$y2CTi/q1VXVHuf5uZsmIce8SE1.mA05jAeIirfzAOr7aIRN2zXF1S', TRUE)
ON CONFLICT (email) DO UPDATE SET
    role = EXCLUDED.role,
    password_hash = COALESCE(users.password_hash, EXCLUDED.password_hash);

-- Ensure demo customer has a primary wallet
INSERT INTO wallets (id, user_id, currency, balance, status)
VALUES ('b0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'USD', 25000.0000, 'active')
ON CONFLICT (id) DO NOTHING;
