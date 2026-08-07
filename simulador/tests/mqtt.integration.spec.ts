import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
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

function credentials(name: string) {
  return {
    ca: readFileSync('../infra/local/certs/ca.crt'),
    cert: readFileSync(`../infra/local/certs/${name}.crt`),
    key: readFileSync(`../infra/local/certs/${name}.key`),
    protocolVersion: 5 as const,
    reconnectPeriod: 0,
  };
}

function subscribeDenied(client: MqttClient, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.subscribe(topic, { qos: 1 }, (error, granted) => {
      if (error) {
        resolve();
        return;
      }
      if (!granted) {
        reject(new Error(`Subscription to ${topic} was not acknowledged`));
      } else {
        resolve();
      }
    });
  });
}

function publishDenied(client: MqttClient, topic: string): Promise<void> {
  return new Promise((resolve, reject) => {
    client.publish(topic, 'denied', { qos: 1 }, (error) => {
      if (error) {
        resolve();
        return;
      }
      reject(new Error(`Publication to ${topic} was accepted`));
    });
  });
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
      TEMPERATURE_MQTT_CLIENT_ID: `temperature-${suffix}`,
      RELAY_MQTT_CLIENT_ID: `relay-${suffix}`,
    });
    const observer = connect(config.MQTT_URL, {
      clientId: `observer-${suffix}`,
      ...credentials('platform-worker'),
    });
    const received = new Map<string, string[]>();
    observer.on('message', (topic, payload) => {
      const messages = received.get(topic) ?? [];
      messages.push(payload.toString('utf8'));
      received.set(topic, messages);
    });

    await waitForConnection(observer);
    await subscribe(observer, 'tenants/demo/devices/+/+');

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
    const relay = new RelayDevice(config, relayMqtt);
    const sensor = new TemperatureSensor(config, temperatureMqtt);
    relayMqtt.setCommandHandler((topic, payload) =>
      relay.handleCommand(topic, payload),
    );
    await Promise.all([temperatureMqtt.connect(), relayMqtt.connect()]);

    try {
      await sensor.publishTelemetry();
      const issuedAt = new Date();
      await publish(
        observer,
        config.relayCommandsTopic,
        JSON.stringify({
          schemaVersion: '1.0',
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
      await Promise.all([temperatureMqtt.disconnect(), relayMqtt.disconnect()]);
      await disconnect(observer);
    }
  });

  it('delivers one queued QoS 1 command after the relay reconnects', async () => {
    const suffix = randomUUID().slice(0, 8);
    const config = createTestConfig({
      RELAY_MQTT_CLIENT_ID: `durable-relay-${suffix}`,
    });
    const platform = connect(config.MQTT_URL, {
      clientId: `platform-${suffix}`,
      ...credentials('platform-worker'),
    });
    const acknowledgements: string[] = [];
    platform.on('message', (topic, payload) => {
      if (topic === config.relayAcksTopic) {
        acknowledgements.push(payload.toString('utf8'));
      }
    });

    const relayMqtt = new MqttConnection(config, {
      clientId: config.RELAY_MQTT_CLIENT_ID,
      certFile: config.RELAY_MQTT_CERT_FILE,
      keyFile: config.RELAY_MQTT_KEY_FILE,
      commandTopic: config.relayCommandsTopic,
    });
    const relay = new RelayDevice(config, relayMqtt);
    relayMqtt.setCommandHandler((topic, payload) =>
      relay.handleCommand(topic, payload),
    );

    await Promise.all([waitForConnection(platform), relayMqtt.connect()]);
    await subscribe(platform, config.relayAcksTopic);

    try {
      await relayMqtt.disconnect();
      const issuedAt = new Date();
      const commandId = `queued-${suffix}`;
      await publish(
        platform,
        config.relayCommandsTopic,
        JSON.stringify({
          schemaVersion: '1.0',
          commandId,
          nonce: `nonce-${suffix}`,
          tenantId: 'demo',
          deviceId: 'relay-001',
          commandType: 'relay.set',
          issuedAt: issuedAt.toISOString(),
          expiresAt: new Date(issuedAt.getTime() + 30_000).toISOString(),
          payload: { state: 'on' },
        }),
      );

      await relayMqtt.connect();
      await waitUntil(() => acknowledgements.length === 1);
      await new Promise((resolve) => setTimeout(resolve, 250));

      expect(acknowledgements).toHaveLength(1);
      expect(
        commandAckSchema.parse(JSON.parse(acknowledgements[0])),
      ).toMatchObject({
        commandId,
        status: 'acknowledged',
        result: { state: 'on' },
      });
    } finally {
      await Promise.all([relayMqtt.disconnect(), disconnect(platform)]);
    }
  });

  it('denies a device access to another device topic', async () => {
    const suffix = randomUUID().slice(0, 8);
    const temp = connect('mqtts://localhost:8883', {
      clientId: `temp-${suffix}`,
      ...credentials('device-temp-001'),
    });
    const other = connect('mqtts://localhost:8883', {
      clientId: `other-${suffix}`,
      ...credentials('device-other-001'),
    });
    const platform = connect('mqtts://localhost:8883', {
      clientId: `platform-${suffix}`,
      ...credentials('platform-worker'),
    });
    let crossDeviceCommandReceived = false;
    other.on('message', () => {
      crossDeviceCommandReceived = true;
    });

    await Promise.all([
      waitForConnection(temp),
      waitForConnection(other),
      waitForConnection(platform),
    ]);
    try {
      await expect(
        publishDenied(other, 'tenants/demo/devices/temp-001/telemetry'),
      ).resolves.toBeUndefined();
      await expect(
        subscribeDenied(other, 'tenants/demo/devices/temp-001/commands'),
      ).resolves.toBeUndefined();
      await publish(
        platform,
        'tenants/demo/devices/temp-001/commands',
        'cross-device-command',
      );
      await new Promise((resolve) => setTimeout(resolve, 250));
      expect(crossDeviceCommandReceived).toBe(false);
      await expect(
        subscribeDenied(temp, 'tenants/demo/devices/other-001/commands'),
      ).resolves.toBeUndefined();
    } finally {
      await Promise.all([
        disconnect(temp),
        disconnect(other),
        disconnect(platform),
      ]);
    }
  });
});
