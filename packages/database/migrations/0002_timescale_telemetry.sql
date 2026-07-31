BEGIN;

CREATE EXTENSION IF NOT EXISTS timescaledb;

ALTER TABLE telemetry_records DROP CONSTRAINT IF EXISTS telemetry_records_pkey;
ALTER TABLE telemetry_records
  ADD PRIMARY KEY (id, occurred_at);

ALTER TABLE telemetry_records
  DROP CONSTRAINT IF EXISTS telemetry_records_organization_id_device_id_message_id_metr_key;
ALTER TABLE telemetry_records
  ADD CONSTRAINT telemetry_records_message_idempotency_key
  UNIQUE (organization_id, device_id, message_id, metric, occurred_at);

SELECT create_hypertable('telemetry_records', 'occurred_at', if_not_exists => TRUE, migrate_data => TRUE);

ALTER TABLE telemetry_records SET (
  timescaledb.compress,
  timescaledb.compress_segmentby = 'organization_id,device_id,metric'
);

SELECT add_compression_policy('telemetry_records', INTERVAL '7 days', if_not_exists => TRUE);
SELECT add_retention_policy('telemetry_records', INTERVAL '90 days', if_not_exists => TRUE);

INSERT INTO schema_migrations (version) VALUES ('0002_timescale_telemetry') ON CONFLICT DO NOTHING;

COMMIT;
