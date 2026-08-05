BEGIN;

CREATE TABLE IF NOT EXISTS device_activation_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  device_id UUID NOT NULL REFERENCES devices(id),
  token_hash TEXT NOT NULL UNIQUE,
  issued_by UUID NOT NULL REFERENCES users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  consumed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (expires_at > created_at)
);

CREATE INDEX IF NOT EXISTS device_activation_tokens_active_idx
  ON device_activation_tokens (device_id, expires_at)
  WHERE consumed_at IS NULL;

-- An exchanged token reserves a credential record; a later mTLS flow binds its certificate thumbprint.
ALTER TABLE device_credentials ALTER COLUMN thumbprint DROP NOT NULL;

INSERT INTO schema_migrations (version) VALUES ('0004_device_activation_tokens') ON CONFLICT DO NOTHING;

COMMIT;
