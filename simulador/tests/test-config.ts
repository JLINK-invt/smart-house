import { readConfig, type SimulatorConfig } from '../src/config';

export function createTestConfig(
  overrides: Partial<NodeJS.ProcessEnv> = {},
): SimulatorConfig {
  return readConfig({
    MQTT_URL: 'mqtt://localhost:1883',
    MQTT_CLIENT_ID: 'smart-house-simulador-test',
    TENANT_ID: 'demo',
    TEMPERATURE_DEVICE_ID: 'temp-001',
    RELAY_DEVICE_ID: 'relay-001',
    PUBLISH_INTERVAL_MS: '30000',
    COMMAND_PROCESSING_DELAY_MS: '0',
    PUBLISH_ONCE: 'false',
    ENABLE_SIMULATION_PROFILES: 'false',
    SIMULATION_PROFILE: 'normal',
    ...overrides,
  });
}
