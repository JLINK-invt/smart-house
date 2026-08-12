import { Module } from '@nestjs/common';
import { HealthModule } from './health/health.module';
import { DevicesModule } from './devices/devices.module';
import { IdentityModule } from './identity/identity.module';
import { OrganizationsModule } from './organizations/organizations.module';
import { SpikeModule } from './spike/spike.module';
import { AlertsModule } from './alerts/alerts.module';
import { DataDeletionModule } from './data-deletion/data-deletion.module';

@Module({
  imports: [
    HealthModule,
    IdentityModule,
    OrganizationsModule,
    DevicesModule,
    AlertsModule,
    DataDeletionModule,
    SpikeModule,
  ],
})
export class AppModule {}
