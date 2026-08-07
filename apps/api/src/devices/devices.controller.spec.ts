import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../identity/bearer-auth.guard';
import { DevicesController, csvCell, telemetryCsv } from './devices.controller';
import type { DevicesService } from './devices.service';

describe('DevicesController', () => {
  const list = jest.fn();
  const telemetry = jest.fn();
  const exportTelemetry = jest.fn();
  const createCommand = jest.fn();
  const devices = {
    list,
    telemetry,
    exportTelemetry,
    createCommand,
  } as unknown as DevicesService;
  const controller = new DevicesController(devices);
  const request = {
    identity: { subject: 'user-1', email: 'user@example.com', roles: [] },
  } as unknown as AuthenticatedRequest;

  beforeEach(() => jest.clearAllMocks());

  it('validates and forwards supported inventory query parameters', async () => {
    await controller.list(request, 'organization-1', {
      q: ' Kitchen ',
      status: 'online',
      type: 'relay',
      limit: '25',
      cursor: 'cursor-value',
    });

    expect(list).toHaveBeenCalledWith(request.identity, 'organization-1', {
      q: 'Kitchen',
      status: 'online',
      type: 'relay',
      limit: 25,
      cursor: 'cursor-value',
    });
  });

  it.each([
    { status: 'unknown' },
    { limit: '101' },
    { limit: '2.5' },
    { q: ['one', 'two'] },
  ])('rejects invalid inventory query parameters: %j', (query) => {
    expect(() => controller.list(request, 'organization-1', query)).toThrow(
      BadRequestException,
    );
    expect(list).not.toHaveBeenCalled();
  });

  it('forwards valid relay commands', () => {
    controller.createCommand(request, 'organization-1', 'device-1', {
      type: ' relay.set ',
      payload: { state: 'on' },
      confirmed: true,
    });
    expect(createCommand).toHaveBeenCalledWith(
      request.identity,
      'organization-1',
      'device-1',
      'relay.set',
      { state: 'on' },
      true,
    );
  });

  it('validates and forwards telemetry ranges', async () => {
    await controller.telemetry(request, 'organization-1', 'device-1', {
      metric: 'temperature',
      from: '2026-08-06T00:00:00.000Z',
      to: '2026-08-06T01:00:00.000Z',
      resolution: 'auto',
    });

    expect(telemetry).toHaveBeenCalledWith(
      request.identity,
      'organization-1',
      'device-1',
      expect.objectContaining({ metric: 'temperature', resolution: 'auto' }),
    );
  });

  it.each([
    {
      metric: 'temperature',
      from: 'invalid',
      to: '2026-08-06T01:00:00.000Z',
      resolution: 'raw',
    },
    {
      metric: 'temperature',
      from: '2026-08-06T01:00:00.000Z',
      to: '2026-08-06T00:00:00.000Z',
      resolution: 'raw',
    },
    {
      metric: 'temperature',
      from: '2026-08-06T00:00:00.000Z',
      to: '2026-08-06T01:00:00.000Z',
      resolution: 'day',
    },
  ])('rejects invalid telemetry query parameters: %j', (query) => {
    expect(() =>
      controller.telemetry(request, 'organization-1', 'device-1', query),
    ).toThrow(BadRequestException);
    expect(telemetry).not.toHaveBeenCalled();
  });

  it('streams a quoted, formula-safe CSV attachment', async () => {
    const exportedTelemetry = {
      metric: '=temperature',
      resolution: 'raw' as const,
      points: [
        {
          occurredAt: '2026-08-06T00:00:00.000Z',
          value: 1,
          unit: 'a,"b\n@unit',
        },
      ],
    };
    exportTelemetry.mockResolvedValue(exportedTelemetry);
    const reply = {
      header: jest.fn().mockReturnThis(),
      type: jest.fn().mockReturnThis(),
      send: jest.fn(),
    };

    await controller.exportTelemetry(
      request,
      'organization-1',
      'device-1',
      {
        metric: '=temperature',
        from: '2026-08-06T00:00:00.000Z',
        to: '2026-08-06T00:30:00.000Z',
        resolution: 'raw',
      },
      reply as never,
    );

    expect(reply.header).toHaveBeenCalledWith(
      'content-disposition',
      'attachment; filename="telemetry.csv"',
    );
    expect(reply.type).toHaveBeenCalledWith('text/csv; charset=utf-8');
    const [[stream]] = reply.send.mock.calls as [[{ pipe: unknown }]];
    expect(stream).toHaveProperty('pipe');
    expect(
      [
        '=formula',
        '+formula',
        '-formula',
        '@formula',
        '\tformula',
        '\rformula',
      ].map(csvCell),
    ).toEqual([
      "'=formula",
      "'+formula",
      "'-formula",
      "'@formula",
      "'\tformula",
      '"\'\rformula"',
    ]);
    expect(csvCell('a,"b\n@unit')).toBe('"a,""b\n@unit"');
    let csv = '';
    for await (const chunk of telemetryCsv(exportedTelemetry)) {
      csv += chunk;
    }
    expect(csv).toContain("'=temperature");
  });
});
