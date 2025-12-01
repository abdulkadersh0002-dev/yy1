-- Client-facing user accounts for mobile/dashboard app
CREATE TABLE IF NOT EXISTS client_users (
    id UUID PRIMARY KEY,
    username TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    roles TEXT[] NOT NULL DEFAULT ARRAY['viewer'],
    status TEXT NOT NULL DEFAULT 'active',
    mfa_secret TEXT,
    mfa_pending_secret TEXT,
    mfa_enabled BOOLEAN NOT NULL DEFAULT FALSE,
    token_version INTEGER NOT NULL DEFAULT 0,
    last_login_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_client_users_username ON client_users(username);

CREATE OR REPLACE FUNCTION set_client_users_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_users_updated_at ON client_users;
CREATE TRIGGER trg_client_users_updated_at
BEFORE UPDATE ON client_users
FOR EACH ROW
EXECUTE FUNCTION set_client_users_updated_at();
