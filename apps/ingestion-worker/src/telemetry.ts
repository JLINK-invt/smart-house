import { startTelemetry, type Telemetry } from '@smart-house/observability';

export const telemetry: Telemetry = startTelemetry(
  'smart-house-ingestion-worker',
);
