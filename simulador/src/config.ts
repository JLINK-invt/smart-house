import { z } from 'zod';

const booleanFromEnvironment = z
  .enum(['true', 'false'])
  .default('false')
  .transform((value) => value === 'true');

const environmentSchema = z.object({
  MQTT_URL: z
    .string()
    .url()
    .refine((value) => new URL(value).protocol === 'mqtts:', {
      message: 'MQTT_URL must use mqtts://',
    })
    .default('mqtts://localhost:8883'),
  MQTT_CA_FILE: z.string().min(1).default('../infra/local/certs/ca.crt'),
  MQTT_SESSION_EXPIRY_SECONDS: z.coerce
    .number()
    .int()
    .min(1)
    .max(86_400)
    .default(3_600),
  MQTT_RECONNECT_PERIOD_MS: z.coerce
    .number()
    .int()
    .min(100)
    .max(60_000)
    .default(1_000),
  TEMPERATURE_MQTT_CLIENT_ID: z
    .string()
    .min(1)
    .max(128)
    .default('smart-house-temperature'),
  TEMPERATURE_MQTT_CERT_FILE: z
    .string()
    .min(1)
    .default('../infra/local/certs/device-temp-001.crt'),
  TEMPERATURE_MQTT_KEY_FILE: z
    .string()
    .min(1)
    .default('../infra/local/certs/device-temp-001.key'),
  RELAY_MQTT_CLIENT_ID: z.string().min(1).max(128).default('smart-house-relay'),
  RELAY_MQTT_CERT_FILE: z
    .string()
    .min(1)
    .default('../infra/local/certs/device-relay-001.crt'),
  RELAY_MQTT_KEY_FILE: z
    .string()
    .min(1)
    .default('../infra/local/certs/device-relay-001.key'),
  TENANT_ID: z.string().min(1).max(64).default('demo'),
  TEMPERATURE_DEVICE_ID: z.string().min(1).max(128).default('temp-001'),
  RELAY_DEVICE_ID: z.string().min(1).max(128).default('relay-001'),
  PUBLISH_INTERVAL_MS: z.coerce.number().int().min(100).default(30_000),
  COMMAND_PROCESSING_DELAY_MS: z.coerce
    .number()
    .int()
    .min(0)
    .max(30_000)
    .default(100),
  PUBLISH_ONCE: booleanFromEnvironment,
  ENABLE_SIMULATION_PROFILES: booleanFromEnvironment,
  SIMULATION_PROFILE: z
    .enum([
      'normal',
      'duplicate-messages',
      'invalid-payloads',
      'unstable-network',
      'relay-failures',
      'burst',
    ])
    .default('normal'),
  SIMULATION_SEED: z.string().min(1).max(128).default('smart-house'),
});

export type SimulatorConfig = z.infer<typeof environmentSchema> & {
  temperatureTelemetryTopic: string;
  relayTelemetryTopic: string;
  relayCommandsTopic: string;
  relayAcksTopic: string;
};

export function readConfig(
  values: NodeJS.ProcessEnv = process.env,
): SimulatorConfig {
  const environment = environmentSchema.parse(values);
  const topicPrefix = `tenants/${environment.TENANT_ID}/devices`;

  return {
    ...environment,
    temperatureTelemetryTopic: `${topicPrefix}/${environment.TEMPERATURE_DEVICE_ID}/telemetry`,
    relayTelemetryTopic: `${topicPrefix}/${environment.RELAY_DEVICE_ID}/telemetry`,
    relayCommandsTopic: `${topicPrefix}/${environment.RELAY_DEVICE_ID}/commands`,
    relayAcksTopic: `${topicPrefix}/${environment.RELAY_DEVICE_ID}/command-acks`,
  };
}
