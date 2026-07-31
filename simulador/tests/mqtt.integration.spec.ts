import { randomUUID } from 'node:crypto';
import { connect, type IClientPublishOptions, type MqttClient } from 'mqtt';
import { commandAckSchema } from '../src/contracts/command-ack';
import { temperatureTelemetrySchema } from '../src/contracts/telemetry';
import { RelayDevice } from '../src/devices/relay-device';
import { TemperatureSensor } from '../src/devices/temperature-sensor';
import { MqttConnection } from '../src/mqtt/mqtt-connection';
import { createTestConfig } from './test-config';

const describeWithBroker =
  process.env.MQTT_INTEGRATION === 'true' ? describe : describe.skip;

function waitForConnection(client: MqttClient): Promise<void> {
  return new Promise((resolve, reject) => {
    client.once('connect', () => resolve());
    client.once('error', reject);
  });
}

function subscribe(client: MqttClient, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

function publish(
  client: MqttClient,
  topic: string,
  payload: string,
  options: IClientPublishOptions = { qos: 1 },
): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, payload, options, (error) =>
      error ? reject(error) : resolve(),
    );
  });
}

function disconnect(client: MqttClient): Promise<void> {
  return new Promise((resolve, reject) =>
    client.end(false, {}, (error) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    }),
  );
}

async function waitUntil(
  predicate: () => boolean,
  timeoutMs = 5_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() >= deadline) {
      throw new Error('Timed out waiting for MQTT message');
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

describeWithBroker('MQTT simulator integration', () => {
  jest.setTimeout(15_000);

  it('publishes temperature and acknowledges a relay command', async () => {
    const suffix = randomUUID().slice(0, 8);
    const config = createTestConfig({
      MQTT_CLIENT_ID: `simulator-${suffix}`,
    });
    const observer = connect(config.MQTT_URL, {
      clientId: `observer-${suffix}`,
      reconnectPeriod: 0,
    });
    const received = new Map<string, string[]>();
    observer.on('message', (topic, payload) => {
      const messages = received.get(topic) ?? [];
      messages.push(payload.toString('utf8'));
      received.set(topic, messages);
    });

    await waitForConnection(observer);
    await subscribe(observer, 'tenants/demo/devices/+/+');

    const mqtt = new MqttConnection(config);
    const relay = new RelayDevice(config, mqtt);
    const sensor = new TemperatureSensor(config, mqtt);
    mqtt.setCommandHandler((topic, payload) =>
      relay.handleCommand(topic, payload),
    );
    await mqtt.connect();

    try {
      await sensor.publishTelemetry();
      const issuedAt = new Date();
      await publish(
        observer,
        config.relayCommandsTopic,
        JSON.stringify({
          commandId: `cmd-${suffix}`,
          nonce: `nonce-${suffix}`,
          tenantId: 'demo',
          deviceId: 'relay-001',
          commandType: 'relay.set',
          issuedAt: issuedAt.toISOString(),
          expiresAt: new Date(issuedAt.getTime() + 30_000).toISOString(),
          payload: { state: 'on' },
        }),
      );

      await waitUntil(
        () => (received.get(config.relayAcksTopic)?.length ?? 0) === 1,
      );

      const temperature = temperatureTelemetrySchema.parse(
        JSON.parse(received.get(config.temperatureTelemetryTopic)?.[0] ?? ''),
      );
      const ack = commandAckSchema.parse(
        JSON.parse(received.get(config.relayAcksTopic)?.[0] ?? ''),
      );
      expect(temperature.deviceId).toBe('temp-001');
      expect(ack).toMatchObject({
        commandId: `cmd-${suffix}`,
        status: 'acknowledged',
        result: { state: 'on' },
      });
    } finally {
      await mqtt.disconnect();
      await disconnect(observer);
    }
  });
});
