BEGIN;

CREATE INDEX IF NOT EXISTS device_credentials_device_active_idx
  ON device_credentials (organization_id, device_id, issued_at DESC)
  WHERE revoked_at IS NULL;

INSERT INTO schema_migrations (version) VALUES ('0005_device_credential_lifecycle') ON CONFLICT DO NOTHING;

COMMIT;
