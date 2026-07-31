import { commandAckSchema } from '../src/contracts/command-ack';
import { relayTelemetrySchema } from '../src/contracts/telemetry';
import { RelayDevice } from '../src/devices/relay-device';
import { MessageIdGenerator } from '../src/message-id';
import { FakePublisher } from './fake-publisher';
import { createTestConfig } from './test-config';

const now = new Date('2026-07-30T12:00:01.000Z');

function createCommand(overrides: Record<string, unknown> = {}) {
  return {
    commandId: 'cmd-001',
    nonce: 'nonce-001',
    tenantId: 'demo',
    deviceId: 'relay-001',
    commandType: 'relay.set',
    issuedAt: '2026-07-30T12:00:00.000Z',
    expiresAt: '2026-07-30T12:00:30.000Z',
    payload: { state: 'on' },
    ...overrides,
  };
}

function createRelay(mqtt: FakePublisher) {
  const config = createTestConfig();
  return {
    config,
    relay: new RelayDevice(
      config,
      mqtt,
      new MessageIdGenerator('msg-relay-001', 'test'),
      new MessageIdGenerator('ack-relay-001', 'test'),
      () => now,
    ),
  };
}

describe('RelayDevice', () => {
  it('executes an on command and publishes state before its ACK', async () => {
    const mqtt = new FakePublisher();
    const { config, relay } = createRelay(mqtt);

    await relay.handleCommand(
      config.relayCommandsTopic,
      Buffer.from(JSON.stringify(createCommand())),
    );

    expect(relay.state).toBe('on');
    expect(mqtt.messages).toHaveLength(2);
    expect(mqtt.messages[0]?.topic).toBe(config.relayTelemetryTopic);
    expect(mqtt.messages[1]?.topic).toBe(config.relayAcksTopic);

    const telemetry = relayTelemetrySchema.parse(
      JSON.parse(mqtt.messages[0]?.payload ?? ''),
    );
    const ack = commandAckSchema.parse(
      JSON.parse(mqtt.messages[1]?.payload ?? ''),
    );
    expect(telemetry.metrics.relayState.value).toBe(true);
    expect(ack).toMatchObject({
      commandId: 'cmd-001',
      status: 'acknowledged',
      result: { state: 'on' },
    });
    expect(mqtt.messages.every(({ options }) => options.qos === 1)).toBe(true);
  });

  it('does not execute a duplicated command twice', async () => {
    const mqtt = new FakePublisher();
    const { config, relay } = createRelay(mqtt);
    const payload = Buffer.from(JSON.stringify(createCommand()));

    await relay.handleCommand(config.relayCommandsTopic, payload);
    await relay.handleCommand(config.relayCommandsTopic, payload);

    const telemetryMessages = mqtt.messages.filter(
      ({ topic }) => topic === config.relayTelemetryTopic,
    );
    const ackMessages = mqtt.messages.filter(
      ({ topic }) => topic === config.relayAcksTopic,
    );
    expect(telemetryMessages).toHaveLength(1);
    expect(ackMessages).toHaveLength(2);
    expect(ackMessages[1]?.payload).toBe(ackMessages[0]?.payload);
  });

  it.each([
    ['tenant_mismatch', { tenantId: 'other' }],
    ['device_mismatch', { deviceId: 'relay-999' }],
  ])('rejects commands with %s', async (errorCode, overrides) => {
    const mqtt = new FakePublisher();
    const { config, relay } = createRelay(mqtt);

    await relay.handleCommand(
      config.relayCommandsTopic,
      Buffer.from(JSON.stringify(createCommand(overrides))),
    );

    expect(relay.state).toBe('off');
    expect(mqtt.messages).toHaveLength(1);
    const ack = commandAckSchema.parse(
      JSON.parse(mqtt.messages[0]?.payload ?? ''),
    );
    expect(ack.status).toBe('failed');
    expect(ack.error?.code).toBe(errorCode);
  });

  it('rejects expired commands without changing relay state', async () => {
    const mqtt = new FakePublisher();
    const { config, relay } = createRelay(mqtt);

    await relay.handleCommand(
      config.relayCommandsTopic,
      Buffer.from(
        JSON.stringify(
          createCommand({ expiresAt: '2026-07-30T12:00:00.500Z' }),
        ),
      ),
    );

    const ack = commandAckSchema.parse(
      JSON.parse(mqtt.messages[0]?.payload ?? ''),
    );
    expect(relay.state).toBe('off');
    expect(ack).toMatchObject({
      status: 'failed',
      error: { code: 'command_expired' },
    });
  });

  it('ignores malformed JSON without stopping subsequent commands', async () => {
    const mqtt = new FakePublisher();
    const { config, relay } = createRelay(mqtt);

    await relay.handleCommand(
      config.relayCommandsTopic,
      Buffer.from('{invalid'),
    );
    await relay.handleCommand(
      config.relayCommandsTopic,
      Buffer.from(JSON.stringify(createCommand())),
    );

    expect(relay.state).toBe('on');
    expect(mqtt.messages).toHaveLength(2);
  });
});
