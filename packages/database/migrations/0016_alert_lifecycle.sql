BEGIN;

CREATE TABLE IF NOT EXISTS alert_transitions (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  alert_id UUID NOT NULL REFERENCES alerts(id),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  actor_id UUID NOT NULL REFERENCES users(id),
  from_state TEXT NOT NULL CHECK (from_state IN ('open', 'acknowledged', 'resolved', 'silenced')),
  to_state TEXT NOT NULL CHECK (to_state IN ('open', 'acknowledged', 'resolved', 'silenced')),
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS alert_transitions_alert_time_idx
  ON alert_transitions (alert_id, occurred_at DESC);

INSERT INTO schema_migrations (version)
VALUES ('0016_alert_lifecycle')
ON CONFLICT DO NOTHING;

COMMIT;
