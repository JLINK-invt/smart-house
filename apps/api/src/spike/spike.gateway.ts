import { Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Telemetry } from '@smart-house/contracts';
import Redis from 'ioredis';
import type { Server } from 'socket.io';
import { readEnvironment } from '../config/environment';

type PersistedTelemetryEvent = {
  correlationId: string;
  metric: string;
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

  async onModuleInit(): Promise<void> {
    await this.redis.subscribe('telemetry.persisted');
    this.redis.on('message', (channel, payload) => {
      if (channel !== 'telemetry.persisted') return;
      try {
        const event = JSON.parse(payload) as PersistedTelemetryEvent;
        this.server.emit('telemetry.persisted', event);
      } catch {
        this.logger.warn('Ignored invalid Redis telemetry event.');
      }
    });
  }

  async onModuleDestroy(): Promise<void> {
    await this.redis.quit();
  }
}
