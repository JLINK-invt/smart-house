import { Controller, Get } from '@nestjs/common';
import type { LatestTelemetry } from '@smart-house/contracts';
import { SpikeService } from './spike.service';

@Controller('spike/telemetry')
export class SpikeController {
  constructor(private readonly spikeService: SpikeService) {}

  @Get('latest')
  getLatestTelemetry(): Promise<LatestTelemetry> {
    return this.spikeService.getLatestTelemetry();
  }
}
