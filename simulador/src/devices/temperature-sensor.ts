import type { SimulatorConfig } from '../config';
import {
  temperatureTelemetrySchema,
  type TemperatureTelemetry,
} from '../contracts/telemetry';
import { log } from '../logger';
import { MessageIdGenerator } from '../message-id';
import type { MqttPublisher } from '../mqtt/transport';

export class TemperatureSensor {
  private timer?: NodeJS.Timeout;

  constructor(
    private readonly config: SimulatorConfig,
    private readonly mqtt: MqttPublisher,
    private readonly messageIds = new MessageIdGenerator(
      `msg-${config.TEMPERATURE_DEVICE_ID}`,
    ),
    private readonly random: () => number = Math.random,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async start(): Promise<void> {
    if (this.timer) {
      return;
    }

    await this.publishTelemetry();
    this.timer = setInterval(() => {
      void this.publishTelemetry().catch((error: unknown) => {
        log('error', 'temperature.publish_failed', {
          deviceId: this.config.TEMPERATURE_DEVICE_ID,
          message: error instanceof Error ? error.message : 'Unknown error',
        });
      });
    }, this.config.PUBLISH_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = undefined;
    }
  }

  async publishTelemetry(): Promise<TemperatureTelemetry> {
    const value = Number((18 + this.random() * 12).toFixed(1));
    const telemetry = temperatureTelemetrySchema.parse({
      messageId: this.messageIds.next(),
      deviceId: this.config.TEMPERATURE_DEVICE_ID,
      deviceType: 'temperature_sensor',
      tenantId: this.config.TENANT_ID,
      occurredAt: this.now().toISOString(),
      metrics: {
        temperature: { value, unit: 'celsius' },
      },
    });

    await this.mqtt.publish(
      this.config.temperatureTelemetryTopic,
      JSON.stringify(telemetry),
      { qos: 1 },
    );
    log('info', 'temperature.published', {
      deviceId: telemetry.deviceId,
      messageId: telemetry.messageId,
      topic: this.config.temperatureTelemetryTopic,
      value,
    });
    return telemetry;
  }
}
