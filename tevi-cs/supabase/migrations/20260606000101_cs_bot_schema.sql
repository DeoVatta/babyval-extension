-- Migration: cs_bot_schema_v1
-- Creates tables for Tevi CS Bot analytics + conversation logging

-- Table: cs_users — track semua user yang pernah chat
CREATE TABLE IF NOT EXISTS cs_users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  username TEXT UNIQUE NOT NULL,
  membership_status TEXT DEFAULT 'none' CHECK (membership_status IN ('none', 'active', 'expired')),
  membership_started_at TIMESTAMPTZ,
  membership_ended_at TIMESTAMPTZ,
  payment_count INT DEFAULT 0,
  first_seen_at TIMESTAMPTZ DEFAULT NOW(),
  last_chat_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: cs_chat_logs — semua pesan chat
CREATE TABLE IF NOT EXISTS cs_chat_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES cs_users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'sukii')),
  message TEXT,
  has_image BOOLEAN DEFAULT FALSE,
  slot INT,
  reply_type TEXT CHECK (reply_type IN ('greeting', 'ai', 'fallback')),
  ai_model TEXT,
  tokens_used INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Table: cs_payment_proofs — bukti transfer / foto payment
CREATE TABLE IF NOT EXISTS cs_payment_proofs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES cs_users(id) ON DELETE SET NULL,
  username TEXT NOT NULL,
  image_url TEXT,
  amount TEXT,
  verified BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_cs_users_username ON cs_users(username);
CREATE INDEX IF NOT EXISTS idx_cs_users_membership ON cs_users(membership_status);
CREATE INDEX IF NOT EXISTS idx_cs_users_last_chat ON cs_users(last_chat_at);
CREATE INDEX IF NOT EXISTS cs_chat_logs_user_id_idx ON cs_chat_logs(user_id);
CREATE INDEX IF NOT EXISTS cs_chat_logs_username_idx ON cs_chat_logs(username);
CREATE INDEX IF NOT EXISTS cs_chat_logs_created_at_idx ON cs_chat_logs(created_at);
CREATE INDEX IF NOT EXISTS cs_payment_proofs_username_idx ON cs_payment_proofs(username);

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION update_cs_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cs_users_updated_at ON cs_users;
CREATE TRIGGER cs_users_updated_at
  BEFORE UPDATE ON cs_users
  FOR EACH ROW EXECUTE FUNCTION update_cs_users_updated_at();
