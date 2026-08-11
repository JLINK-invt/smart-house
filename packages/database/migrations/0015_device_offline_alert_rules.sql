BEGIN;

ALTER TABLE alert_rules
  ADD COLUMN rule_type TEXT NOT NULL DEFAULT 'threshold'
    CHECK (rule_type IN ('threshold', 'device_offline'));

CREATE INDEX IF NOT EXISTS alert_rules_offline_device_idx
  ON alert_rules (organization_id, device_id)
  WHERE enabled AND rule_type = 'device_offline';

INSERT INTO schema_migrations (version)
VALUES ('0015_device_offline_alert_rules')
ON CONFLICT DO NOTHING;

COMMIT;
