import { getNodeAutoInstrumentations } from '@opentelemetry/auto-instrumentations-node';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-http';
import { NodeSDK } from '@opentelemetry/sdk-node';

export type Telemetry = {
  shutdown(): Promise<void>;
};

export function startTelemetry(serviceName: string): Telemetry {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT;
  const telemetry = new NodeSDK({
    serviceName,
    instrumentations: [getNodeAutoInstrumentations()],
    traceExporter: endpoint ? new OTLPTraceExporter({ url: endpoint }) : undefined,
  });

  telemetry.start();
  return telemetry;
}
