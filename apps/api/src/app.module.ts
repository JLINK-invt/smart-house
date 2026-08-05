import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { DevicesModule } from './devices/devices.module';
import { IdentityModule } from './identity/identity.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { SpikeModule } from './spike/spike.module';

@Module({
  imports: [
    HealthModule,
    IdentityModule,
    OrganizationsModule,
    DevicesModule,
    SpikeModule,
  ],
})
export class AppModule {}
