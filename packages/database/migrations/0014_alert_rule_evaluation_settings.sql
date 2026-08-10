BEGIN;

ALTER TABLE alert_rules
  ADD COLUMN duration_seconds INTEGER NOT NULL DEFAULT 0 CHECK (duration_seconds >= 0),
  ADD COLUMN hysteresis DOUBLE PRECISION NOT NULL DEFAULT 0 CHECK (hysteresis >= 0),
  ADD COLUMN cooldown_seconds INTEGER NOT NULL DEFAULT 0 CHECK (cooldown_seconds >= 0),
  ADD COLUMN condition_started_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS alerts_rule_device_resolved_idx
  ON alerts (organization_id, rule_id, device_id, resolved_at DESC)
  WHERE state = 'resolved';

INSERT INTO schema_migrations (version)
VALUES ('0014_alert_rule_evaluation_settings')
ON CONFLICT DO NOTHING;

COMMIT;
