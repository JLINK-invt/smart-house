import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DeviceActivationController } from './device-activation.controller';
import { DevicesController } from './devices.controller';
import { DevicesService } from './devices.service';

@Module({
  imports: [IdentityModule, OrganizationsModule],
  controllers: [DevicesController, DeviceActivationController],
  providers: [DevicesService],
})
export class DevicesModule {}
