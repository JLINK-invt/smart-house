import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Telemetry } from '@smart-house/contracts';
import Redis from 'ioredis';
import type { Server } from 'socket.io';
import { readEnvironment } from '../config/environment';
import { IdentityService } from '../identity/identity.service';
import { OrganizationsService } from '../organizations/organizations.service';

type PersistedTelemetryEvent = {
  correlationId: string;
  metric: string;
  organizationId: string;
  telemetry: Telemetry;
};

@WebSocketGateway({
  namespace: '/spike',
  cors: { origin: true },
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
    await this.redis.subscribe('telemetry.persisted');
    this.redis.on('message', (channel, payload) => {
      if (channel !== 'telemetry.persisted') return;
      try {
        const event = JSON.parse(payload) as PersistedTelemetryEvent;
        for (const socket of this.server.sockets.sockets.values()) {
          if (
            this.socketOrganizations.get(socket.id)?.has(event.organizationId)
          ) {
            socket.emit('telemetry.persisted', event);
          }
        }
      } catch {
        this.logger.warn('Ignored invalid Redis telemetry event.');
      }
    });
  }

  async handleConnection(client: {
    id: string;
    handshake: { auth: { accessToken?: unknown } };
    disconnect: () => void;
  }): Promise<void> {
    const accessToken = client.handshake.auth.accessToken;
    if (typeof accessToken !== 'string') {
      client.disconnect();
      return;
    }
    try {
      const identity = await this.identityService.verify(accessToken);
      this.socketOrganizations.set(
        client.id,
        new Set(
          await this.organizationsService.activeOrganizationIds(identity),
        ),
      );
    } catch {
      client.disconnect();
    }
  }

  handleDisconnect(client: { id: string }): void {
    this.socketOrganizations.delete(client.id);
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
