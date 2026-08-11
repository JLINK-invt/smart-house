import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { metrics } from '@opentelemetry/api';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-http';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { PeriodicExportingMetricReader } from '@opentelemetry/sdk-metrics';
import { NodeSDK } from '@opentelemetry/sdk-node';

export type Telemetry = {
  shutdown(): Promise<void>;
};

export type OperationalMetrics = {
  countTelemetry(outcome: 'accepted' | 'rejected' | 'duplicate'): void;
  recordIngestionLatency(seconds: number): void;
  recordPersistenceLatency(seconds: number): void;
  countWorkerError(component: string): void;
  setBacklog(queue: 'outbox' | 'commands' | 'notifications', value: number): void;
  countNotification(outcome: 'completed' | 'retry' | 'dead_letter' | 'email_sent'): void;
  setCertificateExpiry(certificate: 'worker' | 'ca', seconds: number): void;
};

export function startTelemetry(serviceName: string): Telemetry {
  const traceEndpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const metricEndpoint = process.env.OTEL_EXPORTER_OTLP_METRICS_ENDPOINT;
  const telemetry = new NodeSDK({
    serviceName,
    instrumentations: [getNodeAutoInstrumentations()],
    traceExporter: traceEndpoint
      ? new OTLPTraceExporter({ url: traceEndpoint })
      : undefined,
    metricReader: metricEndpoint
      ? new PeriodicExportingMetricReader({
          exporter: new OTLPMetricExporter({ url: metricEndpoint }),
        })
      : undefined,
  });

  telemetry.start();
  return telemetry;
}

export function createOperationalMetrics(serviceName: string): OperationalMetrics {
  const meter = metrics.getMeter(serviceName);
  const telemetryMessages = meter.createCounter('smart_house_telemetry_messages');
  const ingestionLatency = meter.createHistogram(
    'smart_house_telemetry_ingestion_latency_seconds',
    { unit: 's' },
  );
  const persistenceLatency = meter.createHistogram(
    'smart_house_telemetry_persistence_latency_seconds',
    { unit: 's' },
  );
  const workerErrors = meter.createCounter('smart_house_worker_errors');
  const notifications = meter.createCounter('smart_house_notifications');
  const backlog = new Map<string, number>();
  const certificateExpiry = new Map<string, number>();

  meter
    .createObservableGauge('smart_house_backlog')
    .addCallback((result) => {
      for (const [queue, value] of backlog) result.observe(value, { queue });
    });
  meter
    .createObservableGauge('smart_house_certificate_expiry_seconds')
    .addCallback((result) => {
      for (const [certificate, value] of certificateExpiry)
        result.observe(value, { certificate });
    });

  return {
    countTelemetry: (outcome) => telemetryMessages.add(1, { outcome }),
    recordIngestionLatency: (seconds) => ingestionLatency.record(seconds),
    recordPersistenceLatency: (seconds) => persistenceLatency.record(seconds),
    countWorkerError: (component) => workerErrors.add(1, { component }),
    setBacklog: (queue, value) => backlog.set(queue, value),
    countNotification: (outcome) => notifications.add(1, { outcome }),
    setCertificateExpiry: (certificate, seconds) =>
      certificateExpiry.set(certificate, seconds),
  };
}
