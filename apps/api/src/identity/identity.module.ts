import { Module } from '@nestjs/common';
import { BearerAuthGuard } from './bearer-auth.guard';
import { IdentityService } from './identity.service';

@Module({
  providers: [IdentityService, BearerAuthGuard],
  exports: [IdentityService, BearerAuthGuard],
})
export class IdentityModule {}
