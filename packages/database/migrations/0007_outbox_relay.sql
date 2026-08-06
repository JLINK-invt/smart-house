BEGIN;

CREATE INDEX IF NOT EXISTS outbox_events_pending_order_idx
  ON outbox_events (created_at, id)
  WHERE processed_at IS NULL;

INSERT INTO schema_migrations (version)
VALUES ('0007_outbox_relay')
ON CONFLICT DO NOTHING;

COMMIT;
