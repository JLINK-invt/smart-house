import type { SimulatorConfig } from '../config';
import {
  temperatureTelemetrySchema,
  type TemperatureTelemetry,
} from '../contracts/telemetry';
import { log } from '../logger';
import { MessageIdGenerator } from '../message-id';
import type { MqttPublisher, MqttReconnectController } from '../mqtt/transport';
import { ProfileEngine } from '../profiles/profile-engine';

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
    private readonly profiles?: ProfileEngine,
    private readonly reconnectController?: MqttReconnectController,
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
    const decision = this.profiles?.nextTelemetryDecision() ?? null;
    const messageCount = decision?.messageCount ?? 1;
    let firstTelemetry: TemperatureTelemetry | undefined;

    for (let index = 0; index < messageCount; index += 1) {
      const telemetry = this.createTelemetry(decision);
      firstTelemetry ??= telemetry;
      const payload = decision?.invalidPayload
        ? '{"malformed":'
        : JSON.stringify(telemetry);
      await this.mqtt.publish(this.config.temperatureTelemetryTopic, payload, {
        qos: 1,
      });
      if (decision?.duplicate) {
        await this.mqtt.publish(
          this.config.temperatureTelemetryTopic,
          payload,
          {
            qos: 1,
          },
        );
      }
      log('info', 'temperature.published', {
        deviceId: telemetry.deviceId,
        messageId: telemetry.messageId,
        topic: this.config.temperatureTelemetryTopic,
        value: telemetry.metrics.temperature.value,
      });
    }

    if (
      decision?.reconnectAfterMs !== null &&
      decision?.reconnectAfterMs !== undefined
    ) {
      await this.reconnectController?.reconnectAfter(decision.reconnectAfterMs);
    }

    if (!firstTelemetry) {
      throw new Error('Temperature profile did not generate telemetry');
    }
    return firstTelemetry;
  }

  private createTelemetry(
    decision: ReturnType<ProfileEngine['nextTelemetryDecision']>,
  ): TemperatureTelemetry {
    const minimum = decision?.minimum ?? 18;
    const maximum = decision?.maximum ?? 30;
    const value = this.profiles
      ? this.profiles.nextTemperature(minimum, maximum)
      : Number((minimum + this.random() * (maximum - minimum)).toFixed(1));
    return temperatureTelemetrySchema.parse({
      schemaVersion: '1.0',
      messageId: this.messageIds.next(),
      deviceId: this.config.TEMPERATURE_DEVICE_ID,
      deviceType: 'temperature_sensor',
      tenantId: this.config.TENANT_ID,
      occurredAt: this.now().toISOString(),
      metrics: {
        temperature: { value, unit: 'celsius' },
      },
    });
  }
}
