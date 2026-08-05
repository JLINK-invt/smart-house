import { WorkerService } from './worker.service';
import { temperatureTelemetrySchema } from '@smart-house/contracts';

describe('WorkerService', () => {
  it('is constructible before an MQTT adapter is configured', () => {
    expect(new WorkerService()).toBeInstanceOf(WorkerService);
  });

  it('rejects a schema-valid metric not supported by the registered catalog', async () => {
    const service = new WorkerService();
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'organization-1' }] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'device-1',
            type: 'temperature_sensor',
            capabilityVersion: 'v1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [{ metrics: [] }] });
    (service as unknown as { database: { query: jest.Mock } }).database = {
      query,
    };

    const telemetry = temperatureTelemetrySchema.parse({
      messageId: 'message-1',
      tenantId: 'demo',
      deviceId: 'sensor-1',
      deviceType: 'temperature_sensor',
      occurredAt: '2026-01-01T00:00:00.000Z',
      metrics: { temperature: { value: 20, unit: 'celsius' } },
    });

    await expect(
      (
        service as unknown as {
          persist: (value: typeof telemetry) => Promise<void>;
        }
      ).persist(telemetry),
    ).rejects.toThrow('metric not supported');
  });

  it('rejects telemetry whose type differs from the registered device', async () => {
    const service = new WorkerService();
    const query = jest
      .fn()
      .mockResolvedValueOnce({ rows: [{ id: 'organization-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'device-1', type: 'relay', capabilityVersion: 'v1' }],
      })
      .mockResolvedValueOnce({ rows: [{ metrics: ['relayState'] }] });
    (service as unknown as { database: { query: jest.Mock } }).database = {
      query,
    };
    const telemetry = temperatureTelemetrySchema.parse({
      messageId: 'message-1',
      tenantId: 'demo',
      deviceId: 'sensor-1',
      deviceType: 'temperature_sensor',
      occurredAt: '2026-01-01T00:00:00.000Z',
      metrics: { temperature: { value: 20, unit: 'celsius' } },
    });

    await expect(
      (
        service as unknown as {
          persist: (value: typeof telemetry) => Promise<void>;
        }
      ).persist(telemetry),
    ).rejects.toThrow('type does not match');
  });

  it('marks a device online and records last seen only after telemetry persists', async () => {
    const service = new WorkerService();
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    (service as unknown as { database: { query: jest.Mock } }).database = {
      query,
    };

    await (
      service as unknown as {
        updateDevicePresence: (
          deviceId: string,
          occurredAt: string,
        ) => Promise<void>;
      }
    ).updateDevicePresence('device-1', '2026-01-01T00:00:00.000Z');

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("THEN 'online'"),
      ['device-1', '2026-01-01T00:00:00.000Z', 90],
    );
  });

  it('reconciles stale online devices to offline', async () => {
    const service = new WorkerService();
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    (service as unknown as { database: { query: jest.Mock } }).database = {
      query,
    };

    await (
      service as unknown as { reconcileDeviceStatuses: () => Promise<void> }
    ).reconcileDeviceStatuses();

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("SET status = 'offline'"),
      [90],
    );
  });

  it('does not revive disabled devices from persisted telemetry', async () => {
    const service = new WorkerService();
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    (service as unknown as { database: { query: jest.Mock } }).database = {
      query,
    };

    await (
      service as unknown as {
        updateDevicePresence: (
          deviceId: string,
          occurredAt: string,
        ) => Promise<void>;
      }
    ).updateDevicePresence('device-1', '2026-01-01T00:00:00.000Z');

    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    const statement = calls[0][0];
    expect(statement).toContain("WHEN status = 'disabled' THEN 'disabled'");
  });

  it('keeps out-of-order or stale telemetry from changing presence backwards', async () => {
    const service = new WorkerService();
    const query = jest.fn().mockResolvedValue({ rowCount: 1, rows: [] });
    (service as unknown as { database: { query: jest.Mock } }).database = {
      query,
    };

    await (
      service as unknown as {
        updateDevicePresence: (
          deviceId: string,
          occurredAt: string,
        ) => Promise<void>;
      }
    ).updateDevicePresence('device-1', '2025-12-31T23:00:00.000Z');

    const calls = query.mock.calls as unknown as Array<[string, unknown[]]>;
    const statement = calls[0][0];
    expect(statement).toContain('GREATEST(COALESCE(last_seen_at');
    expect(statement).toContain('$2::timestamptz >= COALESCE(last_seen_at');
    expect(statement).toContain("now() - ($3 * interval '1 second')");
  });
});
