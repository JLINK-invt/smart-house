import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { SpikeModule } from './spike/spike.module';

@Module({
  imports: [HealthModule, SpikeModule],
})
export class AppModule {}
