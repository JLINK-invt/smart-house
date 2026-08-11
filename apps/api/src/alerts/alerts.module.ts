import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { AlertsController } from './alerts.controller';
import { AlertsService } from './alerts.service';

@Module({
  imports: [IdentityModule, OrganizationsModule],
  controllers: [AlertsController],
  providers: [AlertsService],
})
export class AlertsModule {}
