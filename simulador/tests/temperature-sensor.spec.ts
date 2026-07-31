import { temperatureTelemetrySchema } from '../src/contracts/telemetry';
import { TemperatureSensor } from '../src/devices/temperature-sensor';
import { MessageIdGenerator } from '../src/message-id';
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
});
