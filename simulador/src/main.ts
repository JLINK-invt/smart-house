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
    config.SIMULATION_SEED,
  );
  const temperatureMqtt = new MqttConnection(config, {
    clientId: config.TEMPERATURE_MQTT_CLIENT_ID,
    certFile: config.TEMPERATURE_MQTT_CERT_FILE,
    keyFile: config.TEMPERATURE_MQTT_KEY_FILE,
  });
  const relayMqtt = new MqttConnection(config, {
    clientId: config.RELAY_MQTT_CLIENT_ID,
    certFile: config.RELAY_MQTT_CERT_FILE,
    keyFile: config.RELAY_MQTT_KEY_FILE,
    commandTopic: config.relayCommandsTopic,
  });
  const temperatureSensor = new TemperatureSensor(
    config,
    temperatureMqtt,
    undefined,
    undefined,
    undefined,
    profileEngine,
    temperatureMqtt,
  );
  const relay = new RelayDevice(
    config,
    relayMqtt,
    undefined,
    undefined,
    undefined,
    profileEngine,
  );

  relayMqtt.setCommandHandler((topic, payload) =>
    relay.handleCommand(topic, payload),
  );

  const shutdown = async (signal: string): Promise<void> => {
    log('info', 'simulator.stopping', { signal });
    temperatureSensor.stop();
    await Promise.all([temperatureMqtt.disconnect(), relayMqtt.disconnect()]);
    process.exitCode = 0;
  };
  process.once('SIGINT', () => void shutdown('SIGINT'));
  process.once('SIGTERM', () => void shutdown('SIGTERM'));

  const activeProfile = profileEngine.activeProfile();
  log('info', 'simulation.profile_status', {
    active: activeProfile?.name ?? null,
    selected: profileEngine.selectedProfile().name,
  });

  await Promise.all([temperatureMqtt.connect(), relayMqtt.connect()]);
  await relay.publishState();

  if (config.PUBLISH_ONCE) {
    await temperatureSensor.publishTelemetry();
    await Promise.all([temperatureMqtt.disconnect(), relayMqtt.disconnect()]);
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
