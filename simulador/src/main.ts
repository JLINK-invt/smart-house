import 'dotenv/config';
import { readConfig } from './config';
import { RelayDevice } from './devices/relay-device';
import { TemperatureSensor } from './devices/temperature-sensor';
import { log } from './logger';
import { MqttConnection } from './mqtt/mqtt-connection';
import { ProfileEngine } from './profiles/profile-engine';

async function bootstrap(): Promise<void> {
  const config = readConfig();
  const profileEngine = new ProfileEngine(
    config.ENABLE_SIMULATION_PROFILES,
    config.SIMULATION_PROFILE,
  );
  const mqtt = new MqttConnection(config);
  const temperatureSensor = new TemperatureSensor(config, mqtt);
  const relay = new RelayDevice(config, mqtt);

  mqtt.setCommandHandler((topic, payload) =>
    relay.handleCommand(topic, payload),
  );

  const shutdown = async (signal: string): Promise<void> => {
    log('info', 'simulator.stopping', { signal });
    temperatureSensor.stop();
    await mqtt.disconnect();
    process.exitCode = 0;
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const activeProfile = profileEngine.activeProfile();
  log('info', 'simulation.profile_status', {
    active: activeProfile?.name ?? null,
    selected: profileEngine.selectedProfile().name,
  });

  await mqtt.connect();
  await relay.publishState();

  if (config.PUBLISH_ONCE) {
    await temperatureSensor.publishTelemetry();
    await mqtt.disconnect();
    return;
  }

  await temperatureSensor.start();
  log('info', 'simulator.started', {
    intervalMs: config.PUBLISH_INTERVAL_MS,
    relayDeviceId: config.RELAY_DEVICE_ID,
    temperatureDeviceId: config.TEMPERATURE_DEVICE_ID,
    tenantId: config.TENANT_ID,
  });
}

void bootstrap().catch((error: unknown) => {
  log('error', 'simulator.start_failed', {
    message: error instanceof Error ? error.message : 'Unknown error',
  });
  process.exitCode = 1;
});
