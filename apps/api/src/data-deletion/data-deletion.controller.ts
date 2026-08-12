import {
  BadRequestException,
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
import { DataDeletionService } from './data-deletion.service';

@Controller('organizations/:organizationId/data-deletion')
@UseGuards(BearerAuthGuard)
export class DataDeletionController {
  constructor(private readonly deletions: DataDeletionService) {}

  @Post()
  request(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: { confirmation?: unknown },
  ) {
    if (body.confirmation !== 'DELETE') {
      throw new BadRequestException('confirmation must be DELETE.');
    }
    return this.deletions.request(request.identity, organizationId);
  }

  @Get(':jobId')
  status(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('jobId') jobId: string,
  ) {
    return this.deletions.status(request.identity, organizationId, jobId);
  }
}
