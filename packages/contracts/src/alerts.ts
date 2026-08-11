import { z } from 'zod';

export const alertRuleOperatorSchema = z.enum(['gt', 'gte', 'lt', 'lte']);
export const alertSeveritySchema = z.enum(['low', 'medium', 'high', 'critical']);
export const alertStateSchema = z.enum([
  'open',
  'acknowledged',
  'resolved',
  'silenced',
]);
export const alertActionSchema = z.enum(['acknowledge', 'resolve', 'silence']);
export const listAlertsQuerySchema = z
  .object({
    state: alertStateSchema.optional(),
    severity: alertSeveritySchema.optional(),
  })
  .strict();
export const listNotificationsQuerySchema = z
  .object({ unreadOnly: z.enum(['true', 'false']).optional() })
  .strict();

const alertRuleSettingsSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    deviceId: z.string().uuid(),
    cooldownSeconds: z.number().int().min(0).max(86_400).default(0),
    severity: alertSeveritySchema.default('medium'),
  })
  .strict();

export const createAlertRuleSchema = z.union([
  alertRuleSettingsSchema.extend({
    type: z.literal('threshold').default('threshold'),
    metric: z.string().trim().min(1).max(128),
    operator: alertRuleOperatorSchema,
    threshold: z.number().finite(),
    durationSeconds: z.number().int().min(0).max(86_400).default(0),
    hysteresis: z.number().finite().min(0).default(0),
  }),
  alertRuleSettingsSchema.extend({
    type: z.literal('device_offline'),
  }),
]);

export type CreateAlertRule = z.infer<typeof createAlertRuleSchema>;
export type AlertRuleOperator = z.infer<typeof alertRuleOperatorSchema>;
export type AlertSeverity = z.infer<typeof alertSeveritySchema>;
export type AlertState = z.infer<typeof alertStateSchema>;
export type AlertAction = z.infer<typeof alertActionSchema>;
export type ListAlertsQuery = z.infer<typeof listAlertsQuerySchema>;
export type ListNotificationsQuery = z.infer<typeof listNotificationsQuerySchema>;
