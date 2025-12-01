-- Device registrations for client notifications and session tracking
CREATE TABLE IF NOT EXISTS client_devices (
    id UUID PRIMARY KEY,
    user_id UUID NOT NULL REFERENCES client_users(id) ON DELETE CASCADE,
    platform TEXT NOT NULL,
    token TEXT,
    subscription JSONB,
    device_name TEXT,
    os_name TEXT,
    os_version TEXT,
    app_version TEXT,
    build_number TEXT,
    locale TEXT,
    timezone TEXT,
    user_agent TEXT,
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (user_id, platform, token)
);

CREATE INDEX IF NOT EXISTS idx_client_devices_user ON client_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_client_devices_token ON client_devices(token) WHERE token IS NOT NULL;

CREATE OR REPLACE FUNCTION set_client_devices_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    IF NEW.last_seen_at IS NULL THEN
        NEW.last_seen_at = NOW();
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_client_devices_updated_at ON client_devices;
CREATE TRIGGER trg_client_devices_updated_at
BEFORE UPDATE ON client_devices
FOR EACH ROW
EXECUTE FUNCTION set_client_devices_updated_at();
