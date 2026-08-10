import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import {
  type AlertRuleOperator,
  type AlertSeverity,
  type AlertAction,
  type AlertState,
  type CreateAlertRule,
  type ListAlertsQuery,
} from '@smart-house/contracts';
import { Pool } from 'pg';
import { readEnvironment } from '../config/environment';
import type { Identity } from '../identity/identity.service';
import { OrganizationsService } from '../organizations/organizations.service';

export type AlertRule = {
  id: string;
  name: string;
  type: 'threshold' | 'device_offline';
  deviceId: string;
  metric: string;
  operator: AlertRuleOperator;
  threshold: number;
  durationSeconds: number;
  hysteresis: number;
  cooldownSeconds: number;
  severity: AlertSeverity;
  enabled: boolean;
  createdAt: string;
};

export type Alert = {
  id: string;
  ruleId: string;
  deviceId: string;
  metric: string;
  observedValue: number;
  observedAt: string;
  message: string;
  severity: AlertSeverity;
  state: 'open' | 'acknowledged' | 'resolved' | 'silenced';
  openedAt: string;
  resolvedAt: string | null;
};

export type InboxNotification = {
  id: string;
  alertId: string;
  title: string;
  body: string;
  severity: AlertSeverity;
  data: Record<string, unknown>;
  readAt: string | null;
  createdAt: string;
};

const alertStatusTopic = 'alert.status';
const allowedSources: Record<AlertAction, AlertState[]> = {
  acknowledge: ['open'],
  resolve: ['open', 'acknowledged', 'silenced'],
  silence: ['open', 'acknowledged'],
};
const actionStates: Record<AlertAction, AlertState> = {
  acknowledge: 'acknowledged',
  resolve: 'resolved',
  silence: 'silenced',
};

@Injectable()
export class AlertsService implements OnModuleDestroy {
  private readonly database = new Pool({
    connectionString: readEnvironment(process.env).DATABASE_URL,
  });

  constructor(private readonly organizations: OrganizationsService) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async createRule(
    identity: Identity,
    organizationId: string,
    input: CreateAlertRule,
  ): Promise<AlertRule> {
    const membership = await this.organizations.requireMembership(
      identity,
      organizationId,
    );
    if (!['owner', 'admin'].includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and admins can create alert rules.',
      );
    }

    const device = await this.database.query<{
      type: string;
      capabilityVersion: string;
    }>(
      `SELECT type, capability_version AS "capabilityVersion"
       FROM devices WHERE organization_id = $1 AND id = $2`,
      [organizationId, input.deviceId],
    );
    if (!device.rows[0]) throw new NotFoundException('Device was not found.');

    let metric: string;
    let operator: AlertRuleOperator;
    let threshold: number;
    let hysteresis: number;
    if (input.type === 'device_offline') {
      metric = 'device_status';
      operator = 'gt';
      threshold = 0;
      hysteresis = 0;
    } else {
      const catalog = await this.database.query<{ metrics: string[] }>(
        `SELECT metrics FROM device_capability_catalog
         WHERE device_type = $1 AND version = $2`,
        [device.rows[0].type, device.rows[0].capabilityVersion],
      );
      if (!catalog.rows[0]?.metrics.includes(input.metric)) {
        throw new BadRequestException(
          `Metric ${input.metric} is not supported by this device.`,
        );
      }
      metric = input.metric;
      operator = input.operator;
      threshold = input.threshold;
      hysteresis = input.hysteresis;
    }
    const ruleType = input.type ?? 'threshold';

    const result = await this.database.query<AlertRule>(
      `INSERT INTO alert_rules
          (organization_id, name, rule_type, device_id, metric, operator, threshold, duration_seconds,
           hysteresis, cooldown_seconds, severity)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
         RETURNING id, name, rule_type AS type, device_id AS "deviceId", metric, operator, threshold,
                  duration_seconds AS "durationSeconds", hysteresis,
                  cooldown_seconds AS "cooldownSeconds", severity, enabled,
                  created_at AS "createdAt"`,
      [
        organizationId,
        input.name,
        ruleType,
        input.deviceId,
        metric,
        operator,
        threshold,
        input.type === 'device_offline' ? 0 : input.durationSeconds,
        hysteresis,
        input.cooldownSeconds,
        input.severity,
      ],
    );
    return result.rows[0];
  }

  async listRules(
    identity: Identity,
    organizationId: string,
  ): Promise<AlertRule[]> {
    await this.organizations.requireMembership(identity, organizationId);
    const result = await this.database.query<AlertRule>(
      `SELECT id, name, rule_type AS type, device_id AS "deviceId", metric, operator, threshold,
              duration_seconds AS "durationSeconds", hysteresis,
              cooldown_seconds AS "cooldownSeconds", severity, enabled,
              created_at AS "createdAt"
       FROM alert_rules WHERE organization_id = $1
       ORDER BY created_at DESC, id DESC`,
      [organizationId],
    );
    return result.rows;
  }

  async listAlerts(
    identity: Identity,
    organizationId: string,
    filters: ListAlertsQuery = {},
  ): Promise<Alert[]> {
    await this.organizations.requireMembership(identity, organizationId);
    const result = await this.database.query<Alert>(
      `SELECT id, rule_id AS "ruleId", device_id AS "deviceId", metric,
              observed_value AS "observedValue", observed_at AS "observedAt",
              message, severity, state, opened_at AS "openedAt",
              resolved_at AS "resolvedAt"
       FROM alerts WHERE organization_id = $1
         AND ($2::text IS NULL OR state = $2)
         AND ($3::text IS NULL OR severity = $3)
        ORDER BY opened_at DESC, id DESC`,
      [organizationId, filters.state ?? null, filters.severity ?? null],
    );
    return result.rows;
  }

  async transitionAlert(
    identity: Identity,
    organizationId: string,
    alertId: string,
    action: AlertAction,
  ): Promise<Alert> {
    const membership = await this.organizations.requireMembership(
      identity,
      organizationId,
    );
    if (!['owner', 'admin', 'operator'].includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners, admins, and operators can update alerts.',
      );
    }

    const eventId = crypto.randomUUID();
    const target = actionStates[action];
    const result = await this.database.query<Alert>(
      `WITH updated AS (
         UPDATE alerts
         SET state = $4,
             resolved_at = CASE WHEN $4 = 'resolved' THEN now() ELSE resolved_at END
         WHERE id = $2 AND organization_id = $1 AND state = ANY($5::text[])
         RETURNING id, rule_id AS "ruleId", device_id AS "deviceId", metric,
                   observed_value AS "observedValue", observed_at AS "observedAt",
                   message, severity, state, opened_at AS "openedAt",
                   resolved_at AS "resolvedAt", ($5::text[])[1] AS "fromState"
       ), actor AS (
         SELECT id FROM users WHERE subject = $3
       ), transition AS (
         INSERT INTO alert_transitions
           (alert_id, organization_id, actor_id, from_state, to_state)
         SELECT u.id, $1, actor.id, u."fromState", u.state FROM updated u CROSS JOIN actor
       ), audit AS (
         INSERT INTO audit_events
           (organization_id, actor_id, action, resource_type, resource_id, result, correlation_id, metadata)
         SELECT $1, actor.id, $6, 'alert', u.id::text, 'allowed', $7::uuid,
                jsonb_build_object('fromState', u."fromState", 'toState', u.state)
         FROM updated u CROSS JOIN actor
        ), outbox AS (
         INSERT INTO outbox_events (id, organization_id, topic, payload)
         SELECT $7::uuid, $1, $8,
                jsonb_build_object('eventId', $7, 'correlationId', u.id,
                  'organizationId', $1, 'deviceId', u."deviceId",
                  'alert', jsonb_build_object('id', u.id, 'ruleId', u."ruleId",
                    'deviceId', u."deviceId", 'metric', u.metric,
                    'observedValue', u."observedValue", 'observedAt', u."observedAt",
                    'message', u.message, 'severity', u.severity, 'state', u.state,
                    'openedAt', u."openedAt", 'resolvedAt', u."resolvedAt"))
          FROM updated u
        ), notification_job AS (
          INSERT INTO notification_jobs (organization_id, topic, payload, idempotency_key)
          SELECT $1, 'alert.notification',
                 jsonb_build_object('alertId', u.id, 'event', u.state,
                   'severity', u.severity, 'message', u.message,
                   'deviceId', u."deviceId"),
                 'alert:' || u.id::text || ':' || u.state
          FROM updated u
          ON CONFLICT (idempotency_key) DO NOTHING
        )
       SELECT id, "ruleId", "deviceId", metric, "observedValue", "observedAt",
              message, severity, state, "openedAt", "resolvedAt"
       FROM updated`,
      [
        organizationId,
        alertId,
        identity.subject,
        target,
        allowedSources[action],
        `alert.${action}`,
        eventId,
        alertStatusTopic,
      ],
    );
    if (!result.rows[0]) {
      const existing = await this.database.query<{ id: string }>(
        'SELECT id FROM alerts WHERE id = $1 AND organization_id = $2',
        [alertId, organizationId],
      );
      if (!existing.rows[0])
        throw new NotFoundException('Alert was not found.');
      throw new BadRequestException(
        `Alert cannot be ${target} from its current state.`,
      );
    }
    return result.rows[0];
  }

  async listNotifications(
    identity: Identity,
    organizationId: string,
    unreadOnly: boolean,
  ): Promise<{ items: InboxNotification[]; unreadCount: number }> {
    await this.organizations.requireMembership(identity, organizationId);
    const result = await this.database.query<
      InboxNotification & { unreadCount: string }
    >(
      `SELECT n.id, n.alert_id AS "alertId", n.title, n.body, n.severity, n.data,
              n.read_at AS "readAt", n.created_at AS "createdAt",
              count(*) FILTER (WHERE n.read_at IS NULL) OVER ()::text AS "unreadCount"
       FROM in_app_notifications n JOIN users u ON u.id = n.recipient_id
       WHERE n.organization_id = $1 AND u.subject = $2
         AND (NOT $3::boolean OR n.read_at IS NULL)
       ORDER BY n.created_at DESC, n.id DESC LIMIT 100`,
      [organizationId, identity.subject, unreadOnly],
    );
    return {
      items: result.rows,
      unreadCount: Number(result.rows[0]?.unreadCount ?? 0),
    };
  }

  async markNotificationRead(
    identity: Identity,
    organizationId: string,
    notificationId: string,
  ): Promise<InboxNotification> {
    await this.organizations.requireMembership(identity, organizationId);
    const result = await this.database.query<InboxNotification>(
      `UPDATE in_app_notifications n SET read_at = COALESCE(n.read_at, now())
       FROM users u WHERE n.id = $1 AND n.organization_id = $2
         AND n.recipient_id = u.id AND u.subject = $3
       RETURNING n.id, n.alert_id AS "alertId", n.title, n.body, n.severity, n.data,
                 n.read_at AS "readAt", n.created_at AS "createdAt"`,
      [notificationId, organizationId, identity.subject],
    );
    if (!result.rows[0])
      throw new NotFoundException('Notification was not found.');
    return result.rows[0];
  }
}
