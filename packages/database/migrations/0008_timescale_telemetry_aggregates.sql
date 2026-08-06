CREATE INDEX IF NOT EXISTS telemetry_device_metric_time_idx
  ON telemetry_records (organization_id, device_id, metric, occurred_at DESC)
  INCLUDE (value);

CREATE INDEX IF NOT EXISTS telemetry_metric_time_idx
  ON telemetry_records (organization_id, metric, occurred_at DESC)
  INCLUDE (device_id, value);

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_temperature_5m
WITH (
  timescaledb.continuous,
  timescaledb.materialized_only = TRUE,
  timescaledb.create_group_indexes = TRUE
) AS
SELECT
  time_bucket(INTERVAL '5 minutes', occurred_at) AS bucket,
  organization_id,
  device_id,
  avg(value) AS avg_temperature_celsius,
  min(value) AS min_temperature_celsius,
  max(value) AS max_temperature_celsius,
  count(*) AS sample_count
FROM telemetry_records
WHERE metric = 'temperature'
GROUP BY bucket, organization_id, device_id
WITH DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_temperature_1h
WITH (
  timescaledb.continuous,
  timescaledb.materialized_only = TRUE,
  timescaledb.create_group_indexes = TRUE
) AS
SELECT
  time_bucket(INTERVAL '1 hour', occurred_at) AS bucket,
  organization_id,
  device_id,
  avg(value) AS avg_temperature_celsius,
  min(value) AS min_temperature_celsius,
  max(value) AS max_temperature_celsius,
  count(*) AS sample_count
FROM telemetry_records
WHERE metric = 'temperature'
GROUP BY bucket, organization_id, device_id
WITH DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_relay_5m
WITH (
  timescaledb.continuous,
  timescaledb.materialized_only = TRUE,
  timescaledb.create_group_indexes = TRUE
) AS
SELECT
  time_bucket(INTERVAL '5 minutes', occurred_at) AS bucket,
  organization_id,
  device_id,
  first(value, occurred_at)::smallint AS first_state,
  last(value, occurred_at)::smallint AS last_state,
  min(occurred_at) AS first_sample_at,
  max(occurred_at) AS last_sample_at,
  count(*) AS sample_count
FROM telemetry_records
WHERE metric = 'relayState'
GROUP BY bucket, organization_id, device_id
WITH DATA;

CREATE MATERIALIZED VIEW IF NOT EXISTS telemetry_relay_1h
WITH (
  timescaledb.continuous,
  timescaledb.materialized_only = TRUE,
  timescaledb.create_group_indexes = TRUE
) AS
SELECT
  time_bucket(INTERVAL '1 hour', occurred_at) AS bucket,
  organization_id,
  device_id,
  first(value, occurred_at)::smallint AS first_state,
  last(value, occurred_at)::smallint AS last_state,
  min(occurred_at) AS first_sample_at,
  max(occurred_at) AS last_sample_at,
  count(*) AS sample_count
FROM telemetry_records
WHERE metric = 'relayState'
GROUP BY bucket, organization_id, device_id
WITH DATA;

SELECT add_continuous_aggregate_policy(
  'telemetry_temperature_5m',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE
);
SELECT add_continuous_aggregate_policy(
  'telemetry_temperature_1h',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);
SELECT add_continuous_aggregate_policy(
  'telemetry_relay_5m',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '5 minutes',
  schedule_interval => INTERVAL '5 minutes',
  if_not_exists => TRUE
);
SELECT add_continuous_aggregate_policy(
  'telemetry_relay_1h',
  start_offset => INTERVAL '7 days',
  end_offset => INTERVAL '1 hour',
  schedule_interval => INTERVAL '1 hour',
  if_not_exists => TRUE
);

SELECT add_retention_policy('telemetry_temperature_5m', INTERVAL '2 years', if_not_exists => TRUE);
SELECT add_retention_policy('telemetry_temperature_1h', INTERVAL '2 years', if_not_exists => TRUE);
SELECT add_retention_policy('telemetry_relay_5m', INTERVAL '2 years', if_not_exists => TRUE);
SELECT add_retention_policy('telemetry_relay_1h', INTERVAL '2 years', if_not_exists => TRUE);

INSERT INTO schema_migrations (version)
VALUES ('0008_timescale_telemetry_aggregates')
ON CONFLICT DO NOTHING;
