import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import {
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import Redis from 'ioredis';
import type { Server, Socket } from 'socket.io';
import { z } from 'zod';
import { commandStatusEventSchema } from '@smart-house/contracts';
import { readEnvironment } from '../config/environment';
import { IdentityService } from '../identity/identity.service';
import { OrganizationsService } from '../organizations/organizations.service';

const persistedTelemetryEventSchema = z.object({
  eventId: z.string().min(1),
  correlationId: z.string().min(1),
  metric: z.string().min(1),
  organizationId: z.string().min(1),
  telemetry: z.object({ deviceId: z.string().min(1).max(128) }).passthrough(),
});
const commandStatusTopic = 'command.status';

const deviceSubscriptionSchema = z.object({
  organizationId: z.string().min(1),
  deviceId: z.string().min(1).max(128),
});

type GatewayClient = Pick<Socket, 'id' | 'join' | 'disconnect'> & {
  handshake: { auth: { accessToken?: unknown } };
};

const organizationRoom = (organizationId: string) =>
  `organization:${organizationId}`;
const deviceRoom = (organizationId: string, deviceId: string) =>
  `${organizationRoom(organizationId)}:device:${deviceId}`;

@WebSocketGateway({
  namespace: '/spike',
  cors: { origin: true },
  pingInterval: 25_000,
  pingTimeout: 20_000,
})
export class SpikeGateway implements OnModuleInit, OnModuleDestroy {
  @WebSocketServer()
  server!: Server;

  private readonly logger = new Logger(SpikeGateway.name);
  private readonly redis = new Redis(readEnvironment(process.env).REDIS_URL);
  private readonly socketOrganizations = new Map<string, Set<string>>();

  constructor(
    private readonly identityService: IdentityService,
    private readonly organizationsService: OrganizationsService,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.redis.subscribe('telemetry.persisted', commandStatusTopic);
    this.redis.on('message', (channel, payload) => {
      if (channel === 'telemetry.persisted') this.handleRedisMessage(payload);
      if (channel === commandStatusTopic)
        this.handleCommandStatusMessage(payload);
    });
  }

  async handleConnection(client: GatewayClient): Promise<void> {
    const accessToken = client.handshake.auth.accessToken;
    if (typeof accessToken !== 'string') {
      client.disconnect();
      return;
    }
    try {
      const organizations = new Set(
        await this.organizationsService.activeOrganizationIds(
          await this.identityService.verify(accessToken),
        ),
      );
      this.socketOrganizations.set(client.id, organizations);
      for (const organizationId of organizations)
        void client.join(organizationRoom(organizationId));
    } catch {
      client.disconnect();
    }
  }

  @SubscribeMessage('telemetry.subscribe')
  async handleSubscription(
    client: Pick<Socket, 'id' | 'join'>,
    payload: unknown,
  ): Promise<{ ok: boolean }> {
    const subscription = deviceSubscriptionSchema.safeParse(payload);
    if (
      !subscription.success ||
      !this.socketOrganizations
        .get(client.id)
        ?.has(subscription.data.organizationId)
    ) {
      return { ok: false };
    }
    await client.join(
      deviceRoom(subscription.data.organizationId, subscription.data.deviceId),
    );
    return { ok: true };
  }

  handleDisconnect(client: { id: string }): void {
    this.socketOrganizations.delete(client.id);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }

  private handleRedisMessage(payload: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      this.logger.warn('Ignored invalid Redis telemetry event.');
      return;
    }
    const event = persistedTelemetryEventSchema.safeParse(parsed);
    if (!event.success) {
      this.logger.warn('Ignored invalid Redis telemetry event.');
      return;
    }

    // Each API replica subscribes to Redis and emits only to its local members.
    // A Socket.IO Redis adapter is unnecessary because worker PubSub already fans
    // every persisted event out to every replica.
    this.server
      .to([
        organizationRoom(event.data.organizationId),
        deviceRoom(event.data.organizationId, event.data.telemetry.deviceId),
      ])
      .emit('telemetry.persisted', event.data);
  }

  private handleCommandStatusMessage(payload: string): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(payload);
    } catch {
      this.logger.warn('Ignored invalid Redis command status event.');
      return;
    }
    const event = commandStatusEventSchema.safeParse(parsed);
    if (!event.success) {
      this.logger.warn('Ignored invalid Redis command status event.');
      return;
    }
    this.server
      .to([
        organizationRoom(event.data.organizationId),
        deviceRoom(event.data.organizationId, event.data.deviceId),
      ])
      .emit(commandStatusTopic, event.data);
  }
}
