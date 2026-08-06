\set ON_ERROR_STOP on
\timing on

DO $$
BEGIN
  IF to_regclass('telemetry_temperature_5m') IS NULL
     OR to_regclass('telemetry_temperature_1h') IS NULL
     OR to_regclass('telemetry_relay_5m') IS NULL
     OR to_regclass('telemetry_relay_1h') IS NULL THEN
    RAISE EXCEPTION 'Telemetry continuous aggregates are missing; run pnpm db:migrate first';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'telemetry_device_metric_time_idx'
  ) OR NOT EXISTS (
    SELECT 1 FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'telemetry_metric_time_idx'
  ) THEN
    RAISE EXCEPTION 'Expected telemetry history indexes are missing';
  END IF;

  IF (
    SELECT count(*)
    FROM timescaledb_information.jobs
    WHERE hypertable_schema = 'public'
      AND hypertable_name IN (
        'telemetry_temperature_5m', 'telemetry_temperature_1h',
        'telemetry_relay_5m', 'telemetry_relay_1h'
      )
      AND proc_name IN ('policy_refresh_continuous_aggregate', 'policy_retention')
  ) <> 8 THEN
    RAISE EXCEPTION 'Expected one refresh and one retention policy per aggregate';
  END IF;

  IF (
    SELECT count(*)
    FROM timescaledb_information.jobs
    WHERE hypertable_schema = 'public'
      AND hypertable_name IN (
        'telemetry_temperature_5m', 'telemetry_temperature_1h',
        'telemetry_relay_5m', 'telemetry_relay_1h'
      )
      AND proc_name = 'policy_retention'
      AND config ->> 'drop_after' = '2 years'
  ) <> 4 THEN
    RAISE EXCEPTION 'Every telemetry aggregate must retain 2 years';
  END IF;

  IF (
    SELECT count(*)
    FROM timescaledb_information.jobs
    WHERE hypertable_schema = 'public'
      AND hypertable_name IN (
        'telemetry_temperature_5m', 'telemetry_temperature_1h',
        'telemetry_relay_5m', 'telemetry_relay_1h'
      )
      AND proc_name = 'policy_refresh_continuous_aggregate'
      AND config ->> 'start_offset' = '7 days'
  ) <> 4 THEN
    RAISE EXCEPTION 'Every telemetry aggregate must refresh the preceding 7 days';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name IN ('telemetry_relay_5m', 'telemetry_relay_1h')
      AND column_name LIKE '%avg%'
  ) THEN
    RAISE EXCEPTION 'Relay state must not expose an average';
  END IF;
END
$$;

CREATE TEMP TABLE telemetry_benchmark_context AS
SELECT
  '018f0000-0000-7000-8000-000000000008'::uuid AS organization_id,
  '018f0000-0000-7000-8000-000000000009'::uuid AS temperature_device_id,
  '018f0000-0000-7000-8000-00000000000a'::uuid AS relay_device_id,
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '30 days') AS seed_start,
  time_bucket(INTERVAL '1 hour', now()) AS seed_end;

CREATE TEMP TABLE telemetry_benchmark_failures (message text NOT NULL);

-- A rerun removes residue left by an interrupted previous benchmark.
DELETE FROM telemetry_records
WHERE organization_id = '018f0000-0000-7000-8000-000000000008';
DELETE FROM devices
WHERE organization_id = '018f0000-0000-7000-8000-000000000008';
DELETE FROM organizations
WHERE id = '018f0000-0000-7000-8000-000000000008';

CALL refresh_continuous_aggregate(
  'telemetry_temperature_5m',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '31 days'),
  time_bucket(INTERVAL '1 hour', now())
);
CALL refresh_continuous_aggregate(
  'telemetry_temperature_1h',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '31 days'),
  time_bucket(INTERVAL '1 hour', now())
);
CALL refresh_continuous_aggregate(
  'telemetry_relay_5m',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '31 days'),
  time_bucket(INTERVAL '1 hour', now())
);
CALL refresh_continuous_aggregate(
  'telemetry_relay_1h',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '31 days'),
  time_bucket(INTERVAL '1 hour', now())
);

INSERT INTO organizations (id, name)
SELECT organization_id, 'Telemetry aggregate benchmark'
FROM telemetry_benchmark_context;

INSERT INTO devices (id, organization_id, external_id, name, type, capabilities, status)
SELECT temperature_device_id, organization_id, 'benchmark-temperature',
       'Benchmark temperature', 'temperature_sensor', '["temperature"]'::jsonb, 'online'
FROM telemetry_benchmark_context
UNION ALL
SELECT relay_device_id, organization_id, 'benchmark-relay',
       'Benchmark relay', 'relay', '["relayState"]'::jsonb, 'online'
FROM telemetry_benchmark_context;

INSERT INTO telemetry_records (
  organization_id, device_id, message_id, metric, value, unit,
  occurred_at, received_at, schema_version, source_value, source_unit, time_quality
)
SELECT
  context.organization_id,
  context.temperature_device_id,
  'benchmark-temperature-' || extract(epoch FROM sample_at)::bigint,
  'temperature',
  18 + (extract(minute FROM sample_at)::integer % 120) / 10.0,
  'celsius',
  sample_at,
  sample_at + INTERVAL '1 second',
  'v1',
  to_jsonb(18 + (extract(minute FROM sample_at)::integer % 120) / 10.0),
  'celsius',
  'on_time'
FROM telemetry_benchmark_context context
CROSS JOIN LATERAL generate_series(
  context.seed_start,
  context.seed_end - INTERVAL '1 minute',
  INTERVAL '1 minute'
) sample_at;

INSERT INTO telemetry_records (
  organization_id, device_id, message_id, metric, value, unit,
  occurred_at, received_at, schema_version, source_value, source_unit, time_quality
)
SELECT
  context.organization_id,
  context.relay_device_id,
  'benchmark-relay-' || extract(epoch FROM sample_at)::bigint,
  'relayState',
  (extract(epoch FROM sample_at)::bigint / 300) % 2,
  'boolean',
  sample_at,
  sample_at + INTERVAL '1 second',
  'v1',
  to_jsonb(((extract(epoch FROM sample_at)::bigint / 300) % 2) = 1),
  'boolean',
  'on_time'
FROM telemetry_benchmark_context context
CROSS JOIN LATERAL generate_series(
  context.seed_start,
  context.seed_end - INTERVAL '5 minutes',
  INTERVAL '5 minutes'
) sample_at;

CALL refresh_continuous_aggregate(
  'telemetry_temperature_5m',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '30 days'),
  time_bucket(INTERVAL '1 hour', now())
);
CALL refresh_continuous_aggregate(
  'telemetry_temperature_1h',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '30 days'),
  time_bucket(INTERVAL '1 hour', now())
);
CALL refresh_continuous_aggregate(
  'telemetry_relay_5m',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '30 days'),
  time_bucket(INTERVAL '1 hour', now())
);
CALL refresh_continuous_aggregate(
  'telemetry_relay_1h',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '30 days'),
  time_bucket(INTERVAL '1 hour', now())
);

DO $$
DECLARE
  mismatch_count integer;
  invalid_state_count integer;
BEGIN
  WITH expected AS (
    SELECT
      time_bucket(INTERVAL '5 minutes', occurred_at) AS bucket,
      organization_id,
      device_id,
      avg(value) AS avg_value,
      min(value) AS min_value,
      max(value) AS max_value,
      count(*) AS samples
    FROM telemetry_records
    WHERE organization_id = '018f0000-0000-7000-8000-000000000008'
      AND metric = 'temperature'
    GROUP BY bucket, organization_id, device_id
  ), actual AS (
    SELECT aggregate.*
    FROM telemetry_temperature_5m aggregate
    CROSS JOIN telemetry_benchmark_context context
    WHERE aggregate.organization_id = context.organization_id
      AND aggregate.bucket >= context.seed_start
      AND aggregate.bucket < context.seed_end
  )
  SELECT count(*) INTO mismatch_count
  FROM expected
  FULL JOIN actual
    USING (bucket, organization_id, device_id)
  WHERE expected.bucket IS NULL
     OR actual.bucket IS NULL
     OR abs(expected.avg_value - actual.avg_temperature_celsius) > 1e-9
     OR expected.min_value IS DISTINCT FROM actual.min_temperature_celsius
     OR expected.max_value IS DISTINCT FROM actual.max_temperature_celsius
     OR expected.samples IS DISTINCT FROM actual.sample_count;

  IF mismatch_count <> 0 THEN
    INSERT INTO telemetry_benchmark_failures
    VALUES (format('Temperature 5-minute aggregate has %s mismatched buckets', mismatch_count));
  END IF;

  WITH expected AS (
    SELECT
      time_bucket(INTERVAL '1 hour', occurred_at) AS bucket,
      organization_id,
      device_id,
      first(value, occurred_at)::smallint AS first_state,
      last(value, occurred_at)::smallint AS last_state,
      min(occurred_at) AS first_sample_at,
      max(occurred_at) AS last_sample_at,
      count(*) AS samples
    FROM telemetry_records
    WHERE organization_id = '018f0000-0000-7000-8000-000000000008'
      AND metric = 'relayState'
    GROUP BY bucket, organization_id, device_id
  ), actual AS (
    SELECT aggregate.*
    FROM telemetry_relay_1h aggregate
    CROSS JOIN telemetry_benchmark_context context
    WHERE aggregate.organization_id = context.organization_id
      AND aggregate.bucket >= context.seed_start
      AND aggregate.bucket < context.seed_end
  )
  SELECT count(*) INTO mismatch_count
  FROM expected
  FULL JOIN actual
    USING (bucket, organization_id, device_id)
  WHERE (expected.first_state, expected.last_state, expected.first_sample_at,
         expected.last_sample_at, expected.samples)
        IS DISTINCT FROM
        (actual.first_state, actual.last_state, actual.first_sample_at,
         actual.last_sample_at, actual.sample_count);

  IF mismatch_count <> 0 THEN
    INSERT INTO telemetry_benchmark_failures
    VALUES (format('Relay 1-hour aggregate has %s mismatched buckets', mismatch_count));
  END IF;

  SELECT count(*) INTO invalid_state_count
  FROM telemetry_relay_5m
  WHERE organization_id = '018f0000-0000-7000-8000-000000000008'
    AND (first_state NOT IN (0, 1) OR last_state NOT IN (0, 1));

  IF invalid_state_count <> 0 THEN
    INSERT INTO telemetry_benchmark_failures
    VALUES ('Relay aggregate contains states outside canonical 0/1');
  END IF;
END
$$;

SELECT
  application_name,
  hypertable_name,
  schedule_interval,
  config
FROM timescaledb_information.jobs
WHERE hypertable_name IN (
  'telemetry_records', 'telemetry_temperature_5m', 'telemetry_temperature_1h',
  'telemetry_relay_5m', 'telemetry_relay_1h'
)
ORDER BY hypertable_name, application_name;

EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT bucket, avg_temperature_celsius, min_temperature_celsius,
       max_temperature_celsius, sample_count
FROM telemetry_temperature_1h
WHERE organization_id = '018f0000-0000-7000-8000-000000000008'
  AND device_id = '018f0000-0000-7000-8000-000000000009'
  AND bucket >= (SELECT seed_start FROM telemetry_benchmark_context)
ORDER BY bucket;

EXPLAIN (ANALYZE, BUFFERS, COSTS OFF)
SELECT bucket, first_state, last_state, first_sample_at, last_sample_at, sample_count
FROM telemetry_relay_5m
WHERE organization_id = '018f0000-0000-7000-8000-000000000008'
  AND device_id = '018f0000-0000-7000-8000-00000000000a'
  AND bucket >= (SELECT seed_start FROM telemetry_benchmark_context)
ORDER BY bucket;

DO $$
DECLARE
  started_at timestamptz;
  elapsed_ms numeric;
  result_guard numeric;
BEGIN
  started_at := clock_timestamp();
  SELECT sum(avg_temperature_celsius * sample_count) INTO result_guard
  FROM telemetry_temperature_1h
  WHERE organization_id = '018f0000-0000-7000-8000-000000000008'
    AND device_id = '018f0000-0000-7000-8000-000000000009'
    AND bucket >= (SELECT seed_start FROM telemetry_benchmark_context);
  elapsed_ms := extract(epoch FROM clock_timestamp() - started_at) * 1000;

  IF result_guard IS NULL THEN
    INSERT INTO telemetry_benchmark_failures
    VALUES ('Historical benchmark returned no aggregate data');
  END IF;
  IF elapsed_ms > 500 THEN
    INSERT INTO telemetry_benchmark_failures
    VALUES (format('Historical aggregate latency %s ms exceeds the 500 ms local target', elapsed_ms));
  END IF;
  RAISE NOTICE 'Historical aggregate latency: % ms (target <= 500 ms)', round(elapsed_ms, 3);
END
$$;

DELETE FROM telemetry_records
WHERE organization_id = '018f0000-0000-7000-8000-000000000008';
DELETE FROM devices
WHERE organization_id = '018f0000-0000-7000-8000-000000000008';
DELETE FROM organizations
WHERE id = '018f0000-0000-7000-8000-000000000008';

CALL refresh_continuous_aggregate(
  'telemetry_temperature_5m',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '31 days'),
  time_bucket(INTERVAL '1 hour', now())
);
CALL refresh_continuous_aggregate(
  'telemetry_temperature_1h',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '31 days'),
  time_bucket(INTERVAL '1 hour', now())
);
CALL refresh_continuous_aggregate(
  'telemetry_relay_5m',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '31 days'),
  time_bucket(INTERVAL '1 hour', now())
);
CALL refresh_continuous_aggregate(
  'telemetry_relay_1h',
  time_bucket(INTERVAL '1 hour', now() - INTERVAL '31 days'),
  time_bucket(INTERVAL '1 hour', now())
);

SELECT count(*) AS benchmark_rows_after_cleanup
FROM telemetry_records
WHERE organization_id = '018f0000-0000-7000-8000-000000000008';

DO $$
DECLARE
  failures text;
BEGIN
  SELECT string_agg(message, '; ') INTO failures
  FROM telemetry_benchmark_failures;

  IF failures IS NOT NULL THEN
    RAISE EXCEPTION 'Telemetry aggregate verification failed: %', failures;
  END IF;
END
$$;
