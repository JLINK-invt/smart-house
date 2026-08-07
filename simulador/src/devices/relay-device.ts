import type { SimulatorConfig } from '../config';
import { commandAckSchema, type CommandAck } from '../contracts/command-ack';
import { parseJsonPayload } from '../contracts/common';
import {
  relayCommandSchema,
  type RelayCommand,
} from '../contracts/relay-command';
import {
  relayTelemetrySchema,
  type RelayTelemetry,
} from '../contracts/telemetry';
import { log } from '../logger';
import { MessageIdGenerator } from '../message-id';
import type { MqttPublisher } from '../mqtt/transport';
import { ProfileEngine } from '../profiles/profile-engine';

const MAX_REMEMBERED_COMMANDS = 1_000;

export class RelayDevice {
  private enabled = false;
  private readonly processedCommands = new Map<string, CommandAck>();
  private readonly inFlightCommands = new Map<string, Promise<void>>();

  constructor(
    private readonly config: SimulatorConfig,
    private readonly mqtt: MqttPublisher,
    private readonly telemetryMessageIds = new MessageIdGenerator(
      `msg-${config.RELAY_DEVICE_ID}`,
    ),
    private readonly ackMessageIds = new MessageIdGenerator(
      `ack-${config.RELAY_DEVICE_ID}`,
    ),
    private readonly now: () => Date = () => new Date(),
    private readonly profiles?: ProfileEngine,
  ) {}

  get state(): 'on' | 'off' {
    return this.enabled ? 'on' : 'off';
  }

  async handleCommand(topic: string, payload: Buffer): Promise<void> {
    if (topic !== this.config.relayCommandsTopic) {
      log('warn', 'relay.command_ignored', {
        reason: 'unexpected_topic',
        topic,
      });
      return;
    }

    let rawCommand: unknown;
    try {
      rawCommand = parseJsonPayload(payload);
    } catch (error) {
      log('warn', 'relay.command_rejected', {
        reason: 'invalid_json_or_size',
        message: error instanceof Error ? error.message : 'Unknown error',
      });
      return;
    }

    const commandId = this.readCommandId(rawCommand);
    if (!commandId) {
      log('warn', 'relay.command_rejected', { reason: 'missing_command_id' });
      return;
    }

    const parsedCommand = relayCommandSchema.safeParse(rawCommand);
    if (!parsedCommand.success) {
      await this.publishFailure(
        commandId,
        'invalid_command',
        'Command payload does not match the relay contract',
      );
      return;
    }

    const command = parsedCommand.data;
    if (command.tenantId !== this.config.TENANT_ID) {
      await this.publishFailure(
        command.commandId,
        'tenant_mismatch',
        'Command tenant is not allowed for this device',
      );
      return;
    }
    if (command.deviceId !== this.config.RELAY_DEVICE_ID) {
      await this.publishFailure(
        command.commandId,
        'device_mismatch',
        'Command device does not match this relay',
      );
      return;
    }

    const previousAck = this.processedCommands.get(command.commandId);
    if (previousAck) {
      await this.publishAck(previousAck);
      log('info', 'relay.command_duplicate', { commandId: command.commandId });
      return;
    }

    const inFlight = this.inFlightCommands.get(command.commandId);
    if (inFlight) {
      // QoS 1 can redeliver before the first execution has reached its ACK.
      await inFlight;
      log('info', 'relay.command_duplicate', { commandId: command.commandId });
      return;
    }

    if (new Date(command.expiresAt).getTime() <= this.now().getTime()) {
      const ack = this.createFailureAck(
        command.commandId,
        'command_expired',
        'Command expired before it could be executed',
      );
      this.rememberCommand(command.commandId, ack);
      await this.publishAck(ack);
      return;
    }

    const execution = this.execute(command);
    this.inFlightCommands.set(command.commandId, execution);
    try {
      await execution;
    } finally {
      this.inFlightCommands.delete(command.commandId);
    }
  }

  async publishState(): Promise<RelayTelemetry> {
    const telemetry = relayTelemetrySchema.parse({
      schemaVersion: '1.0',
      messageId: this.telemetryMessageIds.next(),
      deviceId: this.config.RELAY_DEVICE_ID,
      deviceType: 'relay',
      tenantId: this.config.TENANT_ID,
      occurredAt: this.now().toISOString(),
      metrics: {
        relayState: { value: this.enabled, unit: 'boolean' },
      },
    });

    await this.mqtt.publish(
      this.config.relayTelemetryTopic,
      JSON.stringify(telemetry),
      { qos: 1 },
    );
    log('info', 'relay.state_published', {
      deviceId: telemetry.deviceId,
      messageId: telemetry.messageId,
      state: this.state,
      topic: this.config.relayTelemetryTopic,
    });
    return telemetry;
  }

  private async execute(command: RelayCommand): Promise<void> {
    const decision = this.profiles?.nextRelayDecision(
      this.config.COMMAND_PROCESSING_DELAY_MS,
    ) ?? { delayMs: this.config.COMMAND_PROCESSING_DELAY_MS, fail: false };
    if (decision.delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, decision.delayMs));
    }

    if (decision.fail) {
      const ack = this.createFailureAck(
        command.commandId,
        'simulated_failure',
        'Command failed due to the active simulation profile',
      );
      this.rememberCommand(command.commandId, ack);
      await this.publishAck(ack);
      log('warn', 'relay.command_simulated_failure', {
        commandId: command.commandId,
      });
      return;
    }

    this.enabled = command.payload.state === 'on';
    await this.publishState();

    const ack = commandAckSchema.parse({
      schemaVersion: '1.0',
      messageId: this.ackMessageIds.next(),
      commandId: command.commandId,
      tenantId: this.config.TENANT_ID,
      deviceId: this.config.RELAY_DEVICE_ID,
      status: 'acknowledged',
      occurredAt: this.now().toISOString(),
      result: { state: this.state },
    });
    this.rememberCommand(command.commandId, ack);
    await this.publishAck(ack);
    log('info', 'relay.command_executed', {
      commandId: command.commandId,
      state: this.state,
    });
  }

  private async publishFailure(
    commandId: string,
    code: string,
    message: string,
  ): Promise<void> {
    const ack = this.createFailureAck(commandId, code, message);
    await this.publishAck(ack);
    log('warn', 'relay.command_rejected', { commandId, reason: code });
  }

  private createFailureAck(
    commandId: string,
    code: string,
    message: string,
  ): CommandAck {
    return commandAckSchema.parse({
      schemaVersion: '1.0',
      messageId: this.ackMessageIds.next(),
      commandId,
      tenantId: this.config.TENANT_ID,
      deviceId: this.config.RELAY_DEVICE_ID,
      status: 'failed',
      occurredAt: this.now().toISOString(),
      error: { code, message },
    });
  }

  private async publishAck(ack: CommandAck): Promise<void> {
    await this.mqtt.publish(this.config.relayAcksTopic, JSON.stringify(ack), {
      qos: 1,
    });
  }

  private rememberCommand(commandId: string, ack: CommandAck): void {
    this.processedCommands.set(commandId, ack);
    if (this.processedCommands.size > MAX_REMEMBERED_COMMANDS) {
      const oldestCommandId = this.processedCommands.keys().next().value;
      if (oldestCommandId) {
        this.processedCommands.delete(oldestCommandId);
      }
    }
  }

  private readCommandId(value: unknown): string | null {
    if (
      typeof value === 'object' &&
      value !== null &&
      'commandId' in value &&
      typeof value.commandId === 'string' &&
      value.commandId.length > 0 &&
      value.commandId.length <= 128
    ) {
      return value.commandId;
    }
    return null;
  }
}
