BEGIN;

CREATE TABLE IF NOT EXISTS device_capability_catalog (
  device_type TEXT NOT NULL,
  version TEXT NOT NULL,
  metrics JSONB NOT NULL DEFAULT '[]',
  commands JSONB NOT NULL DEFAULT '[]',
  PRIMARY KEY (device_type, version)
);

ALTER TABLE devices
  ADD COLUMN IF NOT EXISTS capability_version TEXT NOT NULL DEFAULT 'v1';

INSERT INTO device_capability_catalog (device_type, version, metrics, commands)
VALUES
  ('temperature_sensor', 'v1', '["temperature"]', '[]'),
  ('relay', 'v1', '["relayState"]', '["relay.set"]')
ON CONFLICT (device_type, version) DO UPDATE
SET metrics = EXCLUDED.metrics, commands = EXCLUDED.commands;

INSERT INTO schema_migrations (version) VALUES ('0003_device_capability_catalog') ON CONFLICT DO NOTHING;

COMMIT;
