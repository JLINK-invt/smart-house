BEGIN;

ALTER TABLE commands
  ADD COLUMN IF NOT EXISTS error JSONB;

INSERT INTO schema_migrations (version)
VALUES ('0012_command_ack_error')
ON CONFLICT DO NOTHING;

COMMIT;
