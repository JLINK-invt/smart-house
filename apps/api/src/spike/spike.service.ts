import { Injectable, OnModuleDestroy } from '@nestjs/common';
import type { LatestTelemetry } from '@smart-house/contracts';
import { Pool } from 'pg';
import { readEnvironment } from '../config/environment';

@Injectable()
export class SpikeService implements OnModuleDestroy {
  private readonly database = new Pool({
    connectionString: readEnvironment(process.env).DATABASE_URL,
  });

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async getLatestTelemetry(): Promise<LatestTelemetry> {
    const result = await this.database.query<{
      correlation_id: string;
      device_id: string;
      metric: string;
      value: number;
      unit: string;
      occurred_at: Date;
    }>(
      `SELECT DISTINCT ON (d.external_id, t.metric)
         t.message_id AS correlation_id, d.external_id AS device_id,
         t.metric, t.value, t.unit, t.occurred_at
       FROM telemetry_records t
       JOIN devices d ON d.id = t.device_id
       JOIN organizations o ON o.id = t.organization_id
       WHERE o.name = 'Simulator demo'
       ORDER BY d.external_id, t.metric, t.occurred_at DESC`,
    );

    return result.rows.map((row) => ({
      correlationId: row.correlation_id,
      deviceId: row.device_id,
      metric: row.metric,
      value: row.value,
      unit: row.unit,
      occurredAt: row.occurred_at.toISOString(),
    }));
  }
}
