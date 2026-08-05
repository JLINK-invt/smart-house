import { Controller, Get, Req, UseGuards } from '@nestjs/common';
import type { LatestTelemetry } from '@smart-house/contracts';
import {
  BearerAuthGuard,
  type AuthenticatedRequest,
} from '../identity/bearer-auth.guard';
import { SpikeService } from './spike.service';

@Controller('spike/telemetry')
export class SpikeController {
  constructor(private readonly spikeService: SpikeService) {}

  @Get('latest')
  @UseGuards(BearerAuthGuard)
  getLatestTelemetry(
    @Req() request: AuthenticatedRequest,
  ): Promise<LatestTelemetry> {
    return this.spikeService.getLatestTelemetry(request.identity.subject);
  }
}
