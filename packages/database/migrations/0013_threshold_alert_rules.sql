BEGIN;

ALTER TABLE alert_rules
  ADD COLUMN device_id UUID REFERENCES devices(id),
  ADD COLUMN metric TEXT,
  ADD COLUMN operator TEXT CHECK (operator IN ('gt', 'gte', 'lt', 'lte')),
  ADD COLUMN threshold DOUBLE PRECISION,
  ADD COLUMN severity TEXT NOT NULL DEFAULT 'medium' CHECK (severity IN ('low', 'medium', 'high', 'critical'));

ALTER TABLE alert_rules
  ALTER COLUMN definition SET DEFAULT '{}'::jsonb;

ALTER TABLE alerts
  ADD COLUMN metric TEXT,
  ADD COLUMN observed_value DOUBLE PRECISION,
  ADD COLUMN observed_at TIMESTAMPTZ,
  ADD COLUMN message TEXT;

ALTER TABLE alert_rules
  ALTER COLUMN device_id SET NOT NULL,
  ALTER COLUMN metric SET NOT NULL,
  ALTER COLUMN operator SET NOT NULL,
  ALTER COLUMN threshold SET NOT NULL;

ALTER TABLE alerts
  ALTER COLUMN device_id SET NOT NULL,
  ALTER COLUMN rule_id SET NOT NULL,
  ALTER COLUMN metric SET NOT NULL,
  ALTER COLUMN observed_value SET NOT NULL,
  ALTER COLUMN observed_at SET NOT NULL,
  ALTER COLUMN message SET NOT NULL;

CREATE INDEX IF NOT EXISTS alert_rules_device_metric_idx
  ON alert_rules (organization_id, device_id, metric)
  WHERE enabled;

CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_open_per_rule_device_idx
  ON alerts (rule_id, device_id)
  WHERE state = 'open';

INSERT INTO schema_migrations (version)
VALUES ('0013_threshold_alert_rules')
ON CONFLICT DO NOTHING;

COMMIT;
