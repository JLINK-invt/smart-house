BEGIN;

DROP INDEX IF EXISTS alerts_one_open_per_rule_device_idx;

WITH ranked AS (
  SELECT id,
         row_number() OVER (
           PARTITION BY rule_id, device_id
           ORDER BY opened_at, id
         ) AS position
  FROM alerts
  WHERE state IN ('open', 'acknowledged', 'silenced')
)
UPDATE alerts a
SET state = 'resolved', resolved_at = COALESCE(a.resolved_at, now())
FROM ranked r
WHERE a.id = r.id AND r.position > 1;

CREATE UNIQUE INDEX IF NOT EXISTS alerts_one_active_per_rule_device_idx
  ON alerts (rule_id, device_id)
  WHERE state IN ('open', 'acknowledged', 'silenced');

ALTER TABLE alert_transitions
  ALTER COLUMN actor_id DROP NOT NULL;

INSERT INTO schema_migrations (version)
VALUES ('0019_active_alert_incidents')
ON CONFLICT DO NOTHING;

COMMIT;
