BEGIN;

CREATE INDEX IF NOT EXISTS devices_inventory_cursor_idx
  ON devices (organization_id, name, external_id, id);

INSERT INTO schema_migrations (version) VALUES ('0009_device_inventory_pagination') ON CONFLICT DO NOTHING;

COMMIT;
