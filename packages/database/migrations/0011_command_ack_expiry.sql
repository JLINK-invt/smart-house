BEGIN;

CREATE INDEX IF NOT EXISTS commands_pending_sent_expiry_idx
  ON commands (expires_at, id)
  WHERE status IN ('pending', 'sent');

INSERT INTO schema_migrations (version)
VALUES ('0011_command_ack_expiry')
ON CONFLICT DO NOTHING;

COMMIT;
