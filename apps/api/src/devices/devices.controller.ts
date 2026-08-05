import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  BearerAuthGuard,
  type AuthenticatedRequest,
} from '../identity/bearer-auth.guard';
import {
  DevicesService,
  type DeviceInput,
  type DeviceUpdate,
} from './devices.service';

type DeviceBody = Partial<DeviceInput>;
type CommandBody = { type?: string; payload?: unknown };

@Controller('organizations/:organizationId/devices')
@UseGuards(BearerAuthGuard)
export class DevicesController {
  constructor(private readonly devices: DevicesService) {}

  @Get()
  list(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ) {
    return this.devices.list(request.identity, organizationId);
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
    return this.devices.createCommand(
      request.identity,
      organizationId,
      deviceId,
      body.type.trim(),
      body.payload,
    );
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
}
