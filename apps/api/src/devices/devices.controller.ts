import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { Readable } from 'node:stream';
import type { FastifyReply } from 'fastify';
import {
  BearerAuthGuard,
  type AuthenticatedRequest,
} from '../identity/bearer-auth.guard';
import {
  DevicesService,
  type DeviceTelemetryQuery,
  type DeviceListQuery,
  type DeviceInput,
  type DeviceUpdate,
} from './devices.service';

type DeviceBody = Partial<DeviceInput>;
type CommandBody = { type?: string; payload?: unknown; confirmed?: unknown };
type DeviceListQueryParams = Record<string, string | string[] | undefined>;

export function csvCell(value: string | number | null | undefined): string {
  let text = value === null || value === undefined ? '' : String(value);
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function telemetryCsv(
  telemetry: Awaited<ReturnType<DevicesService['exportTelemetry']>>,
): Readable {
  return Readable.from(
    (function* () {
      yield 'occurredAt,metric,value,unit\r\n';
      for (const point of telemetry.points) {
        yield [point.occurredAt, telemetry.metric, point.value, point.unit]
          .map(csvCell)
          .join(',')
          .concat('\r\n');
      }
    })(),
  );
}

@Controller('organizations/:organizationId/devices')
@UseGuards(BearerAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Query() query: DeviceListQueryParams,
  ) {
    return this.devices.list(
      request.identity,
      organizationId,
      this.listQuery(query),
    );
  }

  @Get('capability-catalog')
  catalog(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ) {
    return this.devices.catalog(request.identity, organizationId);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: DeviceBody,
  ) {
    return this.devices.create(
      request.identity,
      organizationId,
      this.createInput(body),
    );
  }

  @Get(':deviceId/telemetry')
  telemetry(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Query() query: DeviceListQueryParams,
  ) {
    return this.devices.telemetry(
      request.identity,
      organizationId,
      deviceId,
      this.telemetryQuery(query),
    );
  }

  @Get(':deviceId/telemetry/export.csv')
  async exportTelemetry(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Query() query: DeviceListQueryParams,
    @Res() reply: FastifyReply,
  ): Promise<void> {
    const telemetry = await this.devices.exportTelemetry(
      request.identity,
      organizationId,
      deviceId,
      this.telemetryQuery(query),
    );
    reply
      .header('content-disposition', 'attachment; filename="telemetry.csv"')
      .type('text/csv; charset=utf-8')
      .send(telemetryCsv(telemetry));
  }

  @Get(':deviceId')
  detail(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.devices.detail(request.identity, organizationId, deviceId);
  }

  @Patch(':deviceId')
  update(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: DeviceBody,
  ) {
    return this.devices.update(
      request.identity,
      organizationId,
      deviceId,
      this.updateInput(body),
    );
  }

  @Post(':deviceId/disable')
  disable(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.devices.disable(request.identity, organizationId, deviceId);
  }

  @Post(':deviceId/enable')
  enable(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.devices.enable(request.identity, organizationId, deviceId);
  }

  @Post(':deviceId/commands')
  createCommand(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Body() body: CommandBody,
  ) {
    if (!body.type?.trim()) {
      throw new BadRequestException('Command type is required.');
    }
    const type = body.type.trim();
    if (type === 'relay.set') {
      return this.devices.createCommand(
        request.identity,
        organizationId,
        deviceId,
        type,
        body.payload,
        body.confirmed === true,
      );
    }
    return this.devices.createCommand(
      request.identity,
      organizationId,
      deviceId,
      type,
      body.payload,
      body.confirmed === true,
    );
  }

  @Get(':deviceId/commands')
  commands(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.devices.commands(request.identity, organizationId, deviceId);
  }

  @Post(':deviceId/activation-tokens')
  issueActivationToken(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.devices.issueActivationToken(
      request.identity,
      organizationId,
      deviceId,
    );
  }

  @Get(':deviceId/credentials')
  listCredentials(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.devices.listCredentials(
      request.identity,
      organizationId,
      deviceId,
    );
  }

  @Post(':deviceId/credentials/rotate')
  rotateCredentials(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
  ) {
    return this.devices.rotateCredentials(
      request.identity,
      organizationId,
      deviceId,
    );
  }

  @Post(':deviceId/credentials/:credentialReference/revoke')
  revokeCredential(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('deviceId') deviceId: string,
    @Param('credentialReference') credentialReference: string,
  ) {
    return this.devices.revokeCredential(
      request.identity,
      organizationId,
      deviceId,
      credentialReference,
    );
  }

  private createInput(body: DeviceBody): DeviceInput {
    const input = this.updateInput(body);
    if (
      !input.externalId ||
      !input.name ||
      !input.type ||
      !input.capabilityVersion
    ) {
      throw new BadRequestException(
        'External ID, name, and type are required.',
      );
    }
    return input as DeviceInput;
  }

  private updateInput(body: DeviceBody): DeviceUpdate {
    const input: DeviceUpdate = {};
    for (const field of [
      'externalId',
      'name',
      'type',
      'capabilityVersion',
    ] as const) {
      if (body[field] !== undefined) {
        const value = body[field]?.trim();
        if (!value) throw new BadRequestException(`${field} cannot be empty.`);
        input[field] = value;
      }
    }
    return input;
  }

  private listQuery(query: DeviceListQueryParams): DeviceListQuery {
    const value = (name: string) => {
      const parameter = query[name];
      if (parameter === undefined) return undefined;
      if (typeof parameter !== 'string') {
        throw new BadRequestException(`${name} must be a single value.`);
      }
      return parameter.trim();
    };
    const q = value('q');
    const status = value('status');
    const type = value('type');
    const cursor = value('cursor');
    const limit = value('limit');

    if (q && q.length > 200) {
      throw new BadRequestException('q must be at most 200 characters.');
    }
    if (type && type.length > 100) {
      throw new BadRequestException('type must be at most 100 characters.');
    }
    if (
      status &&
      !['inactive', 'offline', 'online', 'disabled'].includes(status)
    ) {
      throw new BadRequestException('status is invalid.');
    }
    if (cursor && cursor.length > 1_000) {
      throw new BadRequestException('cursor is invalid.');
    }
    if (
      limit &&
      (!/^\d+$/.test(limit) || Number(limit) < 1 || Number(limit) > 100)
    ) {
      throw new BadRequestException(
        'limit must be an integer between 1 and 100.',
      );
    }

    return {
      q: q || undefined,
      status: status as DeviceListQuery['status'] | undefined,
      type: type || undefined,
      cursor: cursor || undefined,
      limit: limit ? Number(limit) : undefined,
    };
  }

  private telemetryQuery(query: DeviceListQueryParams): DeviceTelemetryQuery {
    const value = (name: string) => {
      const parameter = query[name];
      if (typeof parameter !== 'string') {
        throw new BadRequestException(
          `${name} is required and must be a single value.`,
        );
      }
      return parameter.trim();
    };
    const metric = value('metric');
    const from = new Date(value('from'));
    const to = new Date(value('to'));
    const resolution = value('resolution');

    if (!metric || metric.length > 128) {
      throw new BadRequestException(
        'metric must be between 1 and 128 characters.',
      );
    }
    if (
      Number.isNaN(from.getTime()) ||
      Number.isNaN(to.getTime()) ||
      from >= to
    ) {
      throw new BadRequestException(
        'from and to must be valid ascending ISO timestamps.',
      );
    }
    if (!['auto', 'raw', '5m', '1h'].includes(resolution)) {
      throw new BadRequestException('resolution must be auto, raw, 5m, or 1h.');
    }
    return {
      metric,
      from,
      to,
      resolution: resolution as DeviceTelemetryQuery['resolution'],
    };
  }
}
