import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { SpikeController } from './spike.controller';
import { SpikeGateway } from './spike.gateway';
import { SpikeService } from './spike.service';

@Module({
  controllers: [SpikeController],
  imports: [IdentityModule, OrganizationsModule],
  providers: [SpikeService, SpikeGateway],
})
export class SpikeModule {}
