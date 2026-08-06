BEGIN;

ALTER TABLE telemetry_records
  ADD COLUMN IF NOT EXISTS schema_version TEXT,
  ADD COLUMN IF NOT EXISTS source_value JSONB,
  ADD COLUMN IF NOT EXISTS source_unit TEXT,
  ADD COLUMN IF NOT EXISTS time_quality TEXT;

UPDATE telemetry_records
SET schema_version = COALESCE(schema_version, 'legacy'),
    source_value = COALESCE(source_value, to_jsonb(value)),
    source_unit = COALESCE(source_unit, unit),
    time_quality = COALESCE(
      time_quality,
      CASE
        WHEN received_at - occurred_at > interval '24 hours' THEN 'late'
        ELSE 'on_time'
      END
    );

ALTER TABLE telemetry_records
  ALTER COLUMN schema_version SET NOT NULL,
  ALTER COLUMN source_value SET NOT NULL,
  ALTER COLUMN source_unit SET NOT NULL,
  ALTER COLUMN time_quality SET NOT NULL;

ALTER TABLE telemetry_records
  DROP CONSTRAINT IF EXISTS telemetry_records_time_quality_check;

ALTER TABLE telemetry_records
  ADD CONSTRAINT telemetry_records_time_quality_check
  CHECK (time_quality IN ('on_time', 'late'));

INSERT INTO schema_migrations (version)
VALUES ('0006_telemetry_normalization')
ON CONFLICT DO NOTHING;

COMMIT;
