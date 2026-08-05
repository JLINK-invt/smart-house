import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  BearerAuthGuard,
  type AuthenticatedRequest,
} from '../identity/bearer-auth.guard';
import { OrganizationsService } from './organizations.service';

@Controller('organizations')
@UseGuards(BearerAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizations: OrganizationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest) {
    return this.organizations.list(request.identity);
  }

  @Post()
  create(
    @Req() request: AuthenticatedRequest,
    @Body() body: { name?: string },
  ) {
    if (!body.name?.trim()) throw new Error('Organization name is required.');
    return this.organizations.create(request.identity, body.name.trim());
  }

  @Get(':organizationId/members')
  members(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ) {
    return this.organizations.members(request.identity, organizationId);
  }

  @Post(':organizationId/members')
  addMember(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: { email?: string; role?: string },
  ) {
    if (!body.email || !body.role)
      throw new Error('Email and role are required.');
    return this.organizations.addMember(
      request.identity,
      organizationId,
      body.email,
      body.role,
    );
  }
}
