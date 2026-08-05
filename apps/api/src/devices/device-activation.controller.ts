import { BadRequestException, Body, Controller, Post } from '@nestjs/common';
import { DevicesService } from './devices.service';

type ActivationExchangeBody = { token?: string; deviceId?: string };

@Controller('device-activation')
export class DeviceActivationController {
  constructor(private readonly devices: DevicesService) {}

  @Post('exchange')
  exchange(@Body() body: ActivationExchangeBody) {
    const token = body.token?.trim();
    const deviceId = body.deviceId?.trim();
    if (!token || !deviceId) {
      throw new BadRequestException(
        'Activation token and device ID are required.',
      );
    }
    return this.devices.exchangeActivationToken(token, deviceId);
  }
}
