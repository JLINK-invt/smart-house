import { Module } from '@nestjs/common';
import { SpikeController } from './spike.controller';
import { SpikeGateway } from './spike.gateway';
import { SpikeService } from './spike.service';

@Module({
  controllers: [SpikeController],
  providers: [SpikeService, SpikeGateway],
})
export class SpikeModule {}
