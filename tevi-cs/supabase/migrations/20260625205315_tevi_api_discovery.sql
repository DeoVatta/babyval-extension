-- Auto-discovery tables for Tevi API
CREATE TABLE IF NOT EXISTS tevi_api_endpoints (
  id SERIAL PRIMARY KEY,
  method TEXT NOT NULL,
  path TEXT NOT NULL,
  full_url TEXT,
  description TEXT,
  sample_request JSONB,
  sample_response JSONB,
  query_params JSONB,
  headers_templates JSONB,
  body_template JSONB,
  discovered_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  use_count INT DEFAULT 0,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT,
  created_by TEXT DEFAULT 'api-discovery',
  UNIQUE(method, path)
);

CREATE TABLE IF NOT EXISTS tevi_auth_tokens (
  id SERIAL PRIMARY KEY,
  token TEXT NOT NULL,
  token_type TEXT DEFAULT 'Bearer',
  user_id TEXT,
  username TEXT,
  expires_at TIMESTAMPTZ,
  acquired_at TIMESTAMPTZ DEFAULT NOW(),
  last_used_at TIMESTAMPTZ,
  is_active BOOLEAN DEFAULT TRUE,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS tevi_conversations_cache (
  id SERIAL PRIMARY KEY,
  conversation_id TEXT UNIQUE NOT NULL,
  username TEXT,
  slug TEXT,
  last_message TEXT,
  last_message_at TIMESTAMPTZ,
  unread_count INT DEFAULT 0,
  is_member BOOLEAN DEFAULT FALSE,
  cached_at TIMESTAMPTZ DEFAULT NOW(),
  source TEXT DEFAULT 'api'
);

CREATE INDEX IF NOT EXISTS idx_api_endpoints_method_path ON tevi_api_endpoints(method, path);
CREATE INDEX IF NOT EXISTS idx_auth_tokens_active ON tevi_auth_tokens(is_active, acquired_at DESC);
CREATE INDEX IF NOT EXISTS idx_conversations_slug ON tevi_conversations_cache(slug);
