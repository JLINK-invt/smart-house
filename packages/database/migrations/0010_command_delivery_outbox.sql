BEGIN;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS mqtt_tenant_id TEXT;

UPDATE organizations
SET mqtt_tenant_id = substring(name FROM '^Simulator (.+)$')
WHERE mqtt_tenant_id IS NULL AND name ~ '^Simulator .+';

CREATE UNIQUE INDEX IF NOT EXISTS organizations_mqtt_tenant_id_unique_idx
  ON organizations (mqtt_tenant_id)
  WHERE mqtt_tenant_id IS NOT NULL;

ALTER TABLE commands
  ADD COLUMN IF NOT EXISTS schema_version TEXT NOT NULL DEFAULT '1.0';

CREATE INDEX IF NOT EXISTS outbox_command_publish_pending_order_idx
  ON outbox_events (created_at, id)
  WHERE processed_at IS NULL AND topic = 'mqtt.command.publish';

INSERT INTO schema_migrations (version)
VALUES ('0010_command_delivery_outbox')
ON CONFLICT DO NOTHING;

COMMIT;
