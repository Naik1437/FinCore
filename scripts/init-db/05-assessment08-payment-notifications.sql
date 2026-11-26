-- FinCore Assessment 08: Payment & Notification Integrations Migration
-- Adds webhook_events and notifications tables for provider event deduplication and sandbox notification delivery

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- 1. Webhook Events Table for idempotent provider event processing and replay defense
CREATE TABLE IF NOT EXISTS webhook_events (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    provider VARCHAR(50) NOT NULL DEFAULT 'fincore_simulated_gateway',
    event_id VARCHAR(255) NOT NULL UNIQUE,
    event_type VARCHAR(100) NOT NULL,
    payload JSONB NOT NULL DEFAULT '{}',
    status VARCHAR(50) NOT NULL DEFAULT 'processed' CHECK (status IN ('received', 'processed', 'failed', 'duplicate')),
    attempts INT NOT NULL DEFAULT 1,
    error_message TEXT,
    processed_at TIMESTAMPTZ DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_events_event_id ON webhook_events(event_id);
CREATE INDEX IF NOT EXISTS idx_webhook_events_event_type ON webhook_events(event_type);
CREATE INDEX IF NOT EXISTS idx_webhook_events_created_at ON webhook_events(created_at);

-- 2. Notifications Table for email and SMS sandbox delivery tracking
CREATE TABLE IF NOT EXISTS notifications (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id UUID REFERENCES users(id) ON DELETE SET NULL,
    channel VARCHAR(20) NOT NULL CHECK (channel IN ('email', 'sms')),
    recipient VARCHAR(255) NOT NULL,
    subject VARCHAR(255),
    body TEXT NOT NULL,
    template VARCHAR(100) NOT NULL,
    status VARCHAR(50) NOT NULL DEFAULT 'delivered' CHECK (status IN ('queued', 'delivered', 'failed')),
    attempts INT NOT NULL DEFAULT 1,
    metadata JSONB DEFAULT '{}',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_status ON notifications(status);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at);
