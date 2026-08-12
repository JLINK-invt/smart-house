import { Module } from '@nestjs/common';
import { IdentityModule } from '../identity/identity.module';
import { OrganizationsModule } from '../organizations/organizations.module';
import { DataDeletionController } from './data-deletion.controller';
import { DataDeletionService } from './data-deletion.service';

@Module({
  imports: [IdentityModule, OrganizationsModule],
  controllers: [DataDeletionController],
  providers: [DataDeletionService],
})
export class DataDeletionModule {}
