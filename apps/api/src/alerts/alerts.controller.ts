import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  alertActionSchema,
  createAlertRuleSchema,
  listAlertsQuerySchema,
  listNotificationsQuerySchema,
} from '@smart-house/contracts';
import {
  BearerAuthGuard,
  type AuthenticatedRequest,
} from '../identity/bearer-auth.guard';
import { AlertsService } from './alerts.service';

@Controller('organizations/:organizationId')
@UseGuards(BearerAuthGuard)
export class AlertsController {
  constructor(private readonly alerts: AlertsService) {}

  @Post('alert-rules')
  createRule(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Body() body: unknown,
  ) {
    const input = createAlertRuleSchema.safeParse(body);
    if (!input.success) {
      throw new BadRequestException('Alert rule request is invalid.');
    }
    return this.alerts.createRule(request.identity, organizationId, input.data);
  }

  @Get('alert-rules')
  listRules(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
  ) {
    return this.alerts.listRules(request.identity, organizationId);
  }

  @Get('alerts')
  listAlerts(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Query() query: unknown,
  ) {
    const filters = listAlertsQuerySchema.safeParse(query);
    if (!filters.success)
      throw new BadRequestException('Alert filters are invalid.');
    return this.alerts.listAlerts(
      request.identity,
      organizationId,
      filters.data,
    );
  }

  @Post('alerts/:alertId/:action')
  transitionAlert(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('alertId') alertId: string,
    @Param('action') action: string,
  ) {
    const parsedAction = alertActionSchema.safeParse(action);
    if (!parsedAction.success)
      throw new BadRequestException('Alert action is invalid.');
    return this.alerts.transitionAlert(
      request.identity,
      organizationId,
      alertId,
      parsedAction.data,
    );
  }

  @Get('notifications')
  listNotifications(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Query() query: unknown,
  ) {
    const filters = listNotificationsQuerySchema.safeParse(query);
    if (!filters.success)
      throw new BadRequestException('Notification filters are invalid.');
    return this.alerts.listNotifications(
      request.identity,
      organizationId,
      filters.data.unreadOnly === 'true',
    );
  }

  @Post('notifications/:notificationId/read')
  markNotificationRead(
    @Req() request: AuthenticatedRequest,
    @Param('organizationId') organizationId: string,
    @Param('notificationId') notificationId: string,
  ) {
    return this.alerts.markNotificationRead(
      request.identity,
      organizationId,
      notificationId,
    );
  }
}
