import { temperatureTelemetrySchema } from '../src/contracts/telemetry';
import { TemperatureSensor } from '../src/devices/temperature-sensor';
import { MessageIdGenerator } from '../src/message-id';
import { ProfileEngine } from '../src/profiles/profile-engine';
import { FakePublisher } from './fake-publisher';
import { createTestConfig } from './test-config';

describe('TemperatureSensor', () => {
  it('publishes realistic temperature telemetry with QoS 1', async () => {
    const mqtt = new FakePublisher();
    const config = createTestConfig();
    const sensor = new TemperatureSensor(
      config,
      mqtt,
      new MessageIdGenerator('msg-temp-001', 'test'),
      () => 0.5,
      () => new Date('2026-07-30T12:00:00.000Z'),
    );

    const telemetry = await sensor.publishTelemetry();

    expect(telemetry).toMatchObject({
      schemaVersion: '1.0',
      messageId: 'msg-temp-001-test-000001',
      deviceId: 'temp-001',
      deviceType: 'temperature_sensor',
      tenantId: 'demo',
      occurredAt: '2026-07-30T12:00:00.000Z',
      metrics: { temperature: { value: 24, unit: 'celsius' } },
    });
    expect(temperatureTelemetrySchema.safeParse(telemetry).success).toBe(true);
    expect(mqtt.messages).toEqual([
      {
        topic: 'tenants/demo/devices/temp-001/telemetry',
        payload: JSON.stringify(telemetry),
        options: { qos: 1 },
      },
    ]);
  });

  it('keeps generated temperatures between 18 and 30 celsius', async () => {
    const config = createTestConfig();
    const minimumSensor = new TemperatureSensor(
      config,
      new FakePublisher(),
      new MessageIdGenerator('minimum', 'test'),
      () => 0,
    );
    const maximumSensor = new TemperatureSensor(
      config,
      new FakePublisher(),
      new MessageIdGenerator('maximum', 'test'),
      () => 1,
    );

    expect(
      (await minimumSensor.publishTelemetry()).metrics.temperature.value,
    ).toBe(18);
    expect(
      (await maximumSensor.publishTelemetry()).metrics.temperature.value,
    ).toBe(30);
  });

  it('keeps normal-profile telemetry valid and singular', async () => {
    const mqtt = new FakePublisher();
    const sensor = new TemperatureSensor(
      createTestConfig(),
      mqtt,
      undefined,
      undefined,
      undefined,
      new ProfileEngine(true, 'normal', 'seed'),
    );

    await sensor.publishTelemetry();

    expect(mqtt.messages).toHaveLength(1);
    expect(mqtt.messages[0]?.options).toEqual({ qos: 1 });
    expect(
      temperatureTelemetrySchema.safeParse(
        JSON.parse(mqtt.messages[0]?.payload ?? ''),
      ).success,
    ).toBe(true);
  });

  it('duplicates valid telemetry when the duplicate profile selects it', async () => {
    const mqtt = new FakePublisher();
    const sensor = new TemperatureSensor(
      createTestConfig(),
      mqtt,
      new MessageIdGenerator('duplicate', 'test'),
      undefined,
      undefined,
      new ProfileEngine(true, 'duplicate-messages', 'seed', () => 0),
    );

    await sensor.publishTelemetry();

    expect(mqtt.messages).toHaveLength(2);
    expect(mqtt.messages[1]?.payload).toBe(mqtt.messages[0]?.payload);
    expect(
      temperatureTelemetrySchema.safeParse(
        JSON.parse(mqtt.messages[0]?.payload ?? ''),
      ).success,
    ).toBe(true);
    expect(mqtt.messages.every(({ options }) => options.qos === 1)).toBe(true);
  });

  it('emits malformed MQTT payloads when selected by the invalid profile', async () => {
    const mqtt = new FakePublisher();
    const sensor = new TemperatureSensor(
      createTestConfig(),
      mqtt,
      undefined,
      undefined,
      undefined,
      new ProfileEngine(true, 'invalid-payloads', 'seed', () => 0),
    );

    await sensor.publishTelemetry();

    expect(mqtt.messages).toHaveLength(1);
    expect(() => {
      JSON.parse(mqtt.messages[0]?.payload ?? '');
    }).toThrow();
  });

  it('publishes a QoS 1 telemetry burst and reconnects periodically', async () => {
    const mqtt = new FakePublisher();
    const reconnectAfter = jest.fn<Promise<void>, [number]>();
    reconnectAfter.mockImplementation(() => Promise.resolve());
    const sensor = new TemperatureSensor(
      createTestConfig(),
      mqtt,
      undefined,
      undefined,
      undefined,
      new ProfileEngine(true, 'burst', 'seed', () => 0),
      { reconnectAfter },
    );

    await sensor.publishTelemetry();

    expect(mqtt.messages).toHaveLength(20);
    expect(mqtt.messages.every(({ options }) => options.qos === 1)).toBe(true);

    const unstableSensor = new TemperatureSensor(
      createTestConfig(),
      mqtt,
      undefined,
      undefined,
      undefined,
      new ProfileEngine(true, 'unstable-network', 'seed', () => 0),
      { reconnectAfter },
    );
    for (let index = 0; index < 5; index += 1) {
      await unstableSensor.publishTelemetry();
    }
    expect(reconnectAfter).toHaveBeenCalledWith(3_000);
  });
});
