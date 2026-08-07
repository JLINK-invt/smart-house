import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  HttpException,
  HttpStatus,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
import {
  commandSchemaVersion,
  relayCommandSchema,
  relaySetPayloadSchema,
  type RelayCommand,
} from '@smart-house/contracts';
import { readEnvironment } from '../config/environment';
import type { Identity } from '../identity/identity.service';
import { OrganizationsService } from '../organizations/organizations.service';

export type DeviceInput = {
  externalId: string;
  name: string;
  type: string;
  capabilityVersion: string;
};

export type DeviceUpdate = Partial<DeviceInput>;

export type DeviceListQuery = {
  q?: string;
  status?: 'inactive' | 'offline' | 'online' | 'disabled';
  type?: string;
  limit?: number;
  cursor?: string;
};

export type TelemetryResolution = 'auto' | 'raw' | '5m' | '1h';

export type DeviceTelemetryQuery = {
  metric: string;
  from: Date;
  to: Date;
  resolution: TelemetryResolution;
};

export type TelemetryPoint = {
  occurredAt: string;
  value: number;
  unit: string;
};

export type DeviceTelemetry = {
  metric: string;
  resolution: Exclude<TelemetryResolution, 'auto'>;
  points: TelemetryPoint[];
};

export type DeviceTelemetryExport = {
  metric: string;
  resolution: Exclude<TelemetryResolution, 'auto'>;
  points: TelemetryPoint[];
};

export const TELEMETRY_EXPORT_ROW_LIMIT = 10_000;

type Device = DeviceInput & {
  id: string;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type DeviceList = {
  items: Device[];
  nextCursor: string | null;
};

type DeviceCursor = Pick<Device, 'name' | 'externalId' | 'id'>;

type CapabilityCatalog = {
  type: string;
  version: string;
  metrics: string[];
  commands: string[];
};

type ActivationToken = {
  id: string;
  expiresAt: string;
};

type ProvisionedCredential = {
  credentialReference: string;
  deviceId: string;
};

export type CredentialMetadata = {
  credentialReference: string;
  issuedAt: string;
  expiresAt: string | null;
  revokedAt: string | null;
  status: 'active' | 'revoked' | 'expired';
};

export type DeviceCommand = {
  id: string;
  type: string;
  status: 'pending' | 'sent' | 'acknowledged' | 'failed' | 'expired';
  expiresAt: string;
  createdAt: string;
  error: { code: string; message: string } | null;
};

export type DeviceCommands = {
  supportedCommands: string[];
  items: DeviceCommand[];
};

@Injectable()
export class DevicesService implements OnModuleDestroy {
  private readonly exportAttempts = new Map<string, number[]>();
  private readonly commandAttempts = new Map<string, number[]>();
  private readonly database = new Pool({
    connectionString: readEnvironment(process.env).DATABASE_URL,
  });

  constructor(private readonly organizations: OrganizationsService) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async list(
    identity: Identity,
    organizationId: string,
    filters: DeviceListQuery = {},
  ): Promise<DeviceList> {
    await this.organizations.requireMembership(identity, organizationId);
    const values: unknown[] = [organizationId];
    const where = ['organization_id = $1'];
    const add = (clause: string, value: unknown) => {
      values.push(value);
      where.push(clause.replace('?', `$${values.length}`));
    };

    if (filters.q) {
      values.push(filters.q);
      const parameter = `$${values.length}`;
      where.push(
        `(name ILIKE '%' || ${parameter} || '%' OR external_id ILIKE '%' || ${parameter} || '%')`,
      );
    }
    if (filters.status) add('status = ?', filters.status);
    if (filters.type) add('type = ?', filters.type);
    if (filters.cursor) {
      const cursor = this.decodeCursor(filters.cursor);
      values.push(cursor.name, cursor.externalId, cursor.id);
      const firstParameter = values.length - 2;
      where.push(
        `(name, external_id, id) > ($${firstParameter}, $${firstParameter + 1}, $${firstParameter + 2})`,
      );
    }

    const limit = filters.limit ?? 25;
    values.push(limit + 1);
    const result = await this.database.query<Device>(
      `SELECT id, external_id AS "externalId", name, type,
               capability_version AS "capabilityVersion", status,
               last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM devices WHERE ${where.join(' AND ')}
       ORDER BY name, external_id, id
       LIMIT $${values.length}`,
      values,
    );
    const hasMore = result.rows.length > limit;
    const items = hasMore ? result.rows.slice(0, limit) : result.rows;
    const lastItem = items.at(-1);
    return {
      items,
      nextCursor: hasMore && lastItem ? this.encodeCursor(lastItem) : null,
    };
  }

  async catalog(
    identity: Identity,
    organizationId: string,
  ): Promise<CapabilityCatalog[]> {
    await this.organizations.requireMembership(identity, organizationId);
    const result = await this.database.query<CapabilityCatalog>(
      `SELECT device_type AS type, version, metrics, commands
       FROM device_capability_catalog ORDER BY device_type, version`,
    );
    return result.rows;
  }

  async detail(
    identity: Identity,
    organizationId: string,
    deviceId: string,
  ): Promise<Device> {
    await this.organizations.requireMembership(identity, organizationId);
    return this.find(organizationId, deviceId);
  }

  async telemetry(
    identity: Identity,
    organizationId: string,
    deviceId: string,
    query: DeviceTelemetryQuery,
  ): Promise<DeviceTelemetry> {
    await this.organizations.requireMembership(identity, organizationId);
    await this.find(organizationId, deviceId);

    const resolution = this.resolveTelemetryResolution(query);
    const result = await this.database.query<{
      occurredAt: Date | string;
      value: number;
      unit: string;
    }>(this.telemetrySql(query.metric, resolution), [
      organizationId,
      deviceId,
      query.metric,
      query.from,
      query.to,
    ]);

    return {
      metric: query.metric,
      resolution,
      points: result.rows.map((point) => ({
        ...point,
        occurredAt:
          typeof point.occurredAt === 'string'
            ? new Date(point.occurredAt).toISOString()
            : point.occurredAt.toISOString(),
      })),
    };
  }

  async exportTelemetry(
    identity: Identity,
    organizationId: string,
    deviceId: string,
    query: DeviceTelemetryQuery,
  ): Promise<DeviceTelemetryExport> {
    await this.organizations.requireMembership(identity, organizationId);
    await this.find(organizationId, deviceId);

    const resolution = this.resolveTelemetryExportResolution(query);
    const auditMetadata = {
      scope: 'organization_device',
      metric: query.metric,
      resolution,
      from: query.from.toISOString(),
      to: query.to.toISOString(),
    };
    if (!this.allowExport(identity.subject)) {
      await this.writeAudit(
        organizationId,
        identity.subject,
        'device.telemetry.export',
        'device',
        deviceId,
        'denied',
        { ...auditMetadata, reason: 'rate_limited' },
      );
      throw new HttpException(
        'Telemetry export rate limit exceeded.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const result = await this.database.query<{
      occurredAt: Date | string;
      value: number;
      unit: string;
    }>(
      this.telemetrySql(
        query.metric,
        resolution,
        TELEMETRY_EXPORT_ROW_LIMIT + 1,
      ),
      [organizationId, deviceId, query.metric, query.from, query.to],
    );
    if (result.rows.length > TELEMETRY_EXPORT_ROW_LIMIT) {
      throw new BadRequestException(
        `Telemetry export exceeds the ${TELEMETRY_EXPORT_ROW_LIMIT} row limit.`,
      );
    }

    await this.writeAudit(
      organizationId,
      identity.subject,
      'device.telemetry.export',
      'device',
      deviceId,
      'allowed',
      { ...auditMetadata, rowCount: result.rows.length },
    );
    return {
      metric: query.metric,
      resolution,
      points: result.rows.map((point) => ({
        ...point,
        occurredAt:
          typeof point.occurredAt === 'string'
            ? new Date(point.occurredAt).toISOString()
            : point.occurredAt.toISOString(),
      })),
    };
  }

  async create(
    identity: Identity,
    organizationId: string,
    input: DeviceInput,
  ): Promise<Device> {
    await this.requireManager(identity, organizationId);
    await this.requireCatalog(input.type, input.capabilityVersion);
    const result = await this.database.query<Device>(
      `INSERT INTO devices (organization_id, external_id, name, type, capability_version)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, external_id AS "externalId", name, type,
                 capability_version AS "capabilityVersion", status,
                 last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [
        organizationId,
        input.externalId,
        input.name,
        input.type,
        input.capabilityVersion,
      ],
    );
    return result.rows[0];
  }

  async update(
    identity: Identity,
    organizationId: string,
    deviceId: string,
    input: DeviceUpdate,
  ): Promise<Device> {
    await this.requireManager(identity, organizationId);
    const fields: string[] = [];
    const values: unknown[] = [organizationId, deviceId];
    const add = (column: string, value: unknown) => {
      values.push(value);
      fields.push(`${column} = $${values.length}`);
    };

    if (input.externalId !== undefined) add('external_id', input.externalId);
    if (input.name !== undefined) add('name', input.name);
    if (input.type !== undefined) add('type', input.type);
    if (input.capabilityVersion !== undefined) {
      add('capability_version', input.capabilityVersion);
    }
    if (input.type !== undefined || input.capabilityVersion !== undefined) {
      const current = await this.find(organizationId, deviceId);
      await this.requireCatalog(
        input.type ?? current.type,
        input.capabilityVersion ?? current.capabilityVersion,
      );
    }
    if (!fields.length) return this.find(organizationId, deviceId);

    fields.push('updated_at = now()');
    const result = await this.database.query<Device>(
      `UPDATE devices SET ${fields.join(', ')}
       WHERE organization_id = $1 AND id = $2
       RETURNING id, external_id AS "externalId", name, type,
                 capability_version AS "capabilityVersion", status,
                 last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      values,
    );
    if (!result.rows[0]) throw new NotFoundException('Device was not found.');
    return result.rows[0];
  }

  async disable(
    identity: Identity,
    organizationId: string,
    deviceId: string,
  ): Promise<Device> {
    await this.requireManager(identity, organizationId);
    const result = await this.database.query<Device>(
      `UPDATE devices SET status = 'disabled', updated_at = now()
       WHERE organization_id = $1 AND id = $2
       RETURNING id, external_id AS "externalId", name, type,
                 capability_version AS "capabilityVersion", status,
                 last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [organizationId, deviceId],
    );
    if (!result.rows[0]) throw new NotFoundException('Device was not found.');
    return result.rows[0];
  }

  async enable(
    identity: Identity,
    organizationId: string,
    deviceId: string,
  ): Promise<Device> {
    await this.requireManager(identity, organizationId);
    const result = await this.database.query<Device>(
      `UPDATE devices SET status = 'inactive', updated_at = now()
       WHERE organization_id = $1 AND id = $2
       RETURNING id, external_id AS "externalId", name, type,
                 capability_version AS "capabilityVersion", status,
                 last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"`,
      [organizationId, deviceId],
    );
    if (!result.rows[0]) throw new NotFoundException('Device was not found.');
    return result.rows[0];
  }

  async createCommand(
    identity: Identity,
    organizationId: string,
    deviceId: string,
    commandType: string,
    payload: unknown,
    confirmed = false,
  ): Promise<{ id: string; type: string; status: string; expiresAt: string }> {
    const membership = await this.organizations.requireMembership(
      identity,
      organizationId,
    );
    if (!['owner', 'admin', 'operator'].includes(membership.role)) {
      await this.writeAudit(
        organizationId,
        identity.subject,
        'device.command.request',
        'device',
        deviceId,
        'denied',
        {
          reason: 'role_not_authorized',
          role: membership.role,
          type: commandType,
        },
      );
      throw new ForbiddenException(
        'Only owners, admins, and operators can issue commands.',
      );
    }
    const device = await this.find(organizationId, deviceId);
    const catalog = await this.requireCatalog(
      device.type,
      device.capabilityVersion,
    );
    if (!catalog.commands.includes(commandType)) {
      await this.writeAudit(
        organizationId,
        identity.subject,
        'device.command.request',
        'device',
        deviceId,
        'denied',
        { reason: 'unsupported_command', type: commandType },
      );
      throw new BadRequestException(
        `Command ${commandType} is not supported by this device.`,
      );
    }
    if (commandType !== 'relay.set') {
      await this.writeAudit(
        organizationId,
        identity.subject,
        'device.command.request',
        'device',
        deviceId,
        'denied',
        { reason: 'unsupported_contract', type: commandType },
      );
      throw new BadRequestException(
        'Only relay.set commands have an MQTT contract.',
      );
    }
    if (!confirmed) {
      await this.writeAudit(
        organizationId,
        identity.subject,
        'device.command.request',
        'device',
        deviceId,
        'denied',
        { reason: 'confirmation_required', type: commandType },
      );
      throw new BadRequestException(
        'relay.set commands require explicit confirmation.',
      );
    }
    const relayPayload = relaySetPayloadSchema.safeParse(payload);
    if (!relayPayload.success) {
      await this.writeAudit(
        organizationId,
        identity.subject,
        'device.command.request',
        'device',
        deviceId,
        'denied',
        { reason: 'invalid_payload', type: commandType },
      );
      throw new BadRequestException(
        'relay.set payload must contain state on or off.',
      );
    }
    if (!this.allowCommand(`${organizationId}:${identity.subject}`)) {
      await this.writeAudit(
        organizationId,
        identity.subject,
        'device.command.request',
        'device',
        deviceId,
        'denied',
        { reason: 'rate_limited', type: commandType },
      );
      throw new HttpException(
        'Command rate limit exceeded.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      const tenant = await client.query<{ tenantId: string | null }>(
        `SELECT mqtt_tenant_id AS "tenantId" FROM organizations
         WHERE id = $1 FOR SHARE`,
        [organizationId],
      );
      const tenantId = tenant.rows[0]?.tenantId;
      if (!tenantId) {
        throw new BadRequestException(
          'Organization has no MQTT tenant mapping.',
        );
      }

      const issuedAt = new Date();
      const command = relayCommandSchema.parse({
        schemaVersion: commandSchemaVersion,
        commandId: crypto.randomUUID(),
        nonce: crypto.randomUUID(),
        tenantId,
        deviceId: device.externalId,
        commandType,
        issuedAt: issuedAt.toISOString(),
        expiresAt: new Date(issuedAt.getTime() + 5 * 60_000).toISOString(),
        payload: relayPayload.data,
      });
      const result = await client.query<{
        id: string;
        type: string;
        status: DeviceCommand['status'];
        expiresAt: string;
      }>(
        `WITH command AS (
           INSERT INTO commands
             (id, organization_id, device_id, requested_by, type, payload, nonce, schema_version, expires_at)
           VALUES ($1, $2, $3, (SELECT id FROM users WHERE subject = $4), $5, $6::jsonb, $7, $8, $9)
           RETURNING id, type, status, expires_at AS "expiresAt"
         ), audited AS (
           INSERT INTO audit_events
             (organization_id, actor_id, action, resource_type, resource_id, result, correlation_id, metadata)
           SELECT $2, (SELECT id FROM users WHERE subject = $4), 'device.command.request',
                  'command', id::text, 'allowed', id,
                  jsonb_build_object('deviceId', $3, 'type', $5, 'schemaVersion', $8)
           FROM command
         ), queued AS (
           INSERT INTO outbox_events (id, organization_id, topic, payload)
           SELECT id, $2, 'mqtt.command.publish', $6::jsonb FROM command
         )
          SELECT id, type, status, "expiresAt" FROM command`,
        [
          command.commandId,
          organizationId,
          deviceId,
          identity.subject,
          command.commandType,
          JSON.stringify(command satisfies RelayCommand),
          command.nonce,
          command.schemaVersion,
          command.expiresAt,
        ],
      );
      await client.query('COMMIT');
      return result.rows[0];
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async commands(
    identity: Identity,
    organizationId: string,
    deviceId: string,
  ): Promise<DeviceCommands> {
    await this.organizations.requireMembership(identity, organizationId);
    const device = await this.find(organizationId, deviceId);
    const catalog = await this.requireCatalog(
      device.type,
      device.capabilityVersion,
    );
    const result = await this.database.query<DeviceCommand>(
      `SELECT id, type, status, expires_at AS "expiresAt", created_at AS "createdAt",
              error
       FROM commands
       WHERE organization_id = $1 AND device_id = $2
       ORDER BY created_at DESC
       LIMIT 20`,
      [organizationId, deviceId],
    );
    return { supportedCommands: catalog.commands, items: result.rows };
  }

  async issueActivationToken(
    identity: Identity,
    organizationId: string,
    deviceId: string,
  ): Promise<{ token: string; expiresAt: string; deviceId: string }> {
    await this.requireManager(identity, organizationId);
    await this.find(organizationId, deviceId);

    const token = randomBytes(32).toString('base64url');
    const tokenHash = this.hashToken(token);
    const result = await this.database.query<ActivationToken>(
      `WITH activation AS (
         INSERT INTO device_activation_tokens
           (organization_id, device_id, token_hash, issued_by, expires_at)
         VALUES ($1, $2, $3, (SELECT id FROM users WHERE subject = $4), now() + interval '15 minutes')
         RETURNING id, organization_id, device_id, issued_by, expires_at
       ), audited AS (
         INSERT INTO audit_events (organization_id, actor_id, action, resource_type, resource_id, result, metadata)
         SELECT organization_id, issued_by, 'device.activation_token.issue', 'device_activation_token', id::text,
                'allowed', jsonb_build_object('deviceId', device_id, 'expiresAt', expires_at)
         FROM activation
         RETURNING id
       )
       SELECT id, expires_at AS "expiresAt" FROM activation`,
      [organizationId, deviceId, tokenHash, identity.subject],
    );
    const activation = result.rows[0];
    return { token, expiresAt: activation.expiresAt, deviceId };
  }

  async listCredentials(
    identity: Identity,
    organizationId: string,
    deviceId: string,
  ): Promise<CredentialMetadata[]> {
    await this.requireManager(identity, organizationId);
    await this.find(organizationId, deviceId);
    const result = await this.database.query<CredentialMetadata>(
      `SELECT id AS "credentialReference", issued_at AS "issuedAt",
              expires_at AS "expiresAt", revoked_at AS "revokedAt",
              CASE
                WHEN revoked_at IS NOT NULL THEN 'revoked'
                WHEN expires_at IS NOT NULL AND expires_at <= now() THEN 'expired'
                ELSE 'active'
              END AS status
       FROM device_credentials
       WHERE organization_id = $1 AND device_id = $2
       ORDER BY issued_at DESC`,
      [organizationId, deviceId],
    );
    return result.rows;
  }

  async rotateCredentials(
    identity: Identity,
    organizationId: string,
    deviceId: string,
  ): Promise<{
    token: string;
    expiresAt: string;
    deviceId: string;
    revokedCredentialReferences: string[];
  }> {
    await this.requireManager(identity, organizationId);
    await this.find(organizationId, deviceId);

    const token = randomBytes(32).toString('base64url');
    const result = await this.database.query<{
      expiresAt: string;
      revokedCredentialReferences: string[];
    }>(
      `WITH revoked AS (
         UPDATE device_credentials
         SET revoked_at = now()
         WHERE organization_id = $1 AND device_id = $2 AND revoked_at IS NULL
         RETURNING id
       ), activation AS (
         INSERT INTO device_activation_tokens
           (organization_id, device_id, token_hash, issued_by, expires_at)
         VALUES ($1, $2, $3, (SELECT id FROM users WHERE subject = $4), now() + interval '15 minutes')
         RETURNING id, organization_id, device_id, issued_by, expires_at
       ), audited AS (
         INSERT INTO audit_events (organization_id, actor_id, action, resource_type, resource_id, result, metadata)
         SELECT organization_id, issued_by, 'device.credential.rotate', 'device', device_id::text,
                'allowed', jsonb_build_object(
                  'revokedCredentialReferences', (SELECT COALESCE(jsonb_agg(id::text), '[]'::jsonb) FROM revoked),
                  'activationTokenId', id,
                  'expiresAt', expires_at
                )
         FROM activation
         RETURNING id
       )
       SELECT expires_at AS "expiresAt",
              (SELECT COALESCE(array_agg(id::text), ARRAY[]::text[]) FROM revoked) AS "revokedCredentialReferences"
       FROM activation`,
      [organizationId, deviceId, this.hashToken(token), identity.subject],
    );
    const rotation = result.rows[0];
    return {
      token,
      expiresAt: rotation.expiresAt,
      deviceId,
      revokedCredentialReferences: rotation.revokedCredentialReferences,
    };
  }

  async revokeCredential(
    identity: Identity,
    organizationId: string,
    deviceId: string,
    credentialReference: string,
  ): Promise<CredentialMetadata> {
    await this.requireManager(identity, organizationId);
    const result = await this.database.query<CredentialMetadata>(
      `WITH revoked AS (
         UPDATE device_credentials
         SET revoked_at = now()
         WHERE organization_id = $1 AND device_id = $2 AND id = $3 AND revoked_at IS NULL
         RETURNING id, issued_at, expires_at, revoked_at
       ), audited AS (
         INSERT INTO audit_events (organization_id, actor_id, action, resource_type, resource_id, result, metadata)
         SELECT $1, (SELECT id FROM users WHERE subject = $4), 'device.credential.revoke',
                'device_credential', id::text, 'allowed', jsonb_build_object('deviceId', $2)
         FROM revoked
         RETURNING id
       )
       SELECT id AS "credentialReference", issued_at AS "issuedAt", expires_at AS "expiresAt",
              revoked_at AS "revokedAt", 'revoked' AS status
       FROM revoked`,
      [organizationId, deviceId, credentialReference, identity.subject],
    );
    if (result.rows[0]) return result.rows[0];

    await this.writeAudit(
      organizationId,
      identity.subject,
      'device.credential.revoke',
      'device_credential',
      credentialReference,
      'denied',
      { deviceId },
    );
    throw new NotFoundException('Active credential was not found.');
  }

  async exchangeActivationToken(
    token: string,
    deviceId: string,
  ): Promise<{ deviceIdentity: string; credentialReference: string }> {
    const tokenHash = this.hashToken(token);
    const exchanged = await this.database.query<ProvisionedCredential>(
      `WITH consumed AS (
         UPDATE device_activation_tokens
         SET consumed_at = now()
         WHERE token_hash = $1 AND device_id = $2
           AND consumed_at IS NULL AND expires_at > now()
         RETURNING organization_id, device_id, id
       ), credential AS (
         INSERT INTO device_credentials (organization_id, device_id, thumbprint)
         SELECT organization_id, device_id, NULL FROM consumed
         RETURNING id, device_id
       ), audited AS (
         INSERT INTO audit_events (organization_id, actor_id, action, resource_type, resource_id, result, metadata)
         SELECT organization_id, NULL, 'device.activation_token.exchange', 'device_activation_token', id::text,
                'allowed', jsonb_build_object('deviceId', device_id, 'credentialReference', (SELECT id FROM credential))
         FROM consumed
         RETURNING id
       )
       SELECT id AS "credentialReference", device_id AS "deviceId" FROM credential`,
      [tokenHash, deviceId],
    );
    if (exchanged.rows[0]) {
      const credential = exchanged.rows[0];
      return {
        deviceIdentity: `device:${credential.deviceId}`,
        credentialReference: credential.credentialReference,
      };
    }

    const scopedToken = await this.database.query<{
      id: string;
      organizationId: string;
      deviceId: string;
    }>(
      `SELECT id, organization_id AS "organizationId", device_id AS "deviceId"
       FROM device_activation_tokens WHERE token_hash = $1`,
      [tokenHash],
    );
    const failed = scopedToken.rows[0];
    if (failed) {
      await this.writeAudit(
        failed.organizationId,
        null,
        'device.activation_token.exchange',
        'device_activation_token',
        failed.id,
        'denied',
        { requestedDeviceId: deviceId, deviceId: failed.deviceId },
      );
    }
    throw new ForbiddenException(
      'Activation token is invalid, expired, or already used.',
    );
  }

  private async requireManager(identity: Identity, organizationId: string) {
    const membership = await this.organizations.requireMembership(
      identity,
      organizationId,
    );
    if (!['owner', 'admin'].includes(membership.role)) {
      throw new ForbiddenException(
        'Only owners and admins can manage devices.',
      );
    }
  }

  private resolveTelemetryResolution(
    query: DeviceTelemetryQuery,
  ): Exclude<TelemetryResolution, 'auto'> {
    const rangeMilliseconds = query.to.getTime() - query.from.getTime();
    const ranges = {
      raw: 24 * 60 * 60 * 1_000,
      '5m': 31 * 24 * 60 * 60 * 1_000,
      '1h': 2 * 365 * 24 * 60 * 60 * 1_000,
    } as const;
    const requested = query.resolution;
    const resolution =
      requested === 'auto'
        ? rangeMilliseconds <= ranges.raw
          ? 'raw'
          : rangeMilliseconds <= ranges['5m']
            ? '5m'
            : '1h'
        : requested;

    if (rangeMilliseconds > ranges[resolution]) {
      throw new BadRequestException(
        `The requested ${resolution} resolution does not support this range.`,
      );
    }
    return resolution;
  }

  private resolveTelemetryExportResolution(
    query: DeviceTelemetryQuery,
  ): Exclude<TelemetryResolution, 'auto'> {
    const resolution = this.resolveTelemetryResolution(query);
    const ranges = {
      raw: 60 * 60 * 1_000,
      '5m': 7 * 24 * 60 * 60 * 1_000,
      '1h': 90 * 24 * 60 * 60 * 1_000,
    } as const;
    if (query.to.getTime() - query.from.getTime() > ranges[resolution]) {
      throw new BadRequestException(
        `Telemetry export at ${resolution} resolution exceeds its maximum range.`,
      );
    }
    return resolution;
  }

  private telemetrySql(
    metric: string,
    resolution: Exclude<TelemetryResolution, 'auto'>,
    limit?: number,
  ): string {
    const rowLimit = limit ? ` LIMIT ${limit}` : '';
    if (resolution === 'raw') {
      return `SELECT occurred_at AS "occurredAt", value, unit
              FROM telemetry_records
              WHERE organization_id = $1 AND device_id = $2 AND metric = $3
                AND occurred_at >= $4 AND occurred_at <= $5
               ORDER BY occurred_at${rowLimit}`;
    }

    if (metric === 'temperature') {
      if (resolution === '5m') {
        return `SELECT bucket AS "occurredAt", avg_temperature_celsius AS value, 'celsius' AS unit
                FROM telemetry_temperature_5m
                WHERE organization_id = $1 AND device_id = $2
                  AND bucket >= $4
                  AND bucket < time_bucket('5 minutes', LEAST($5, now() - interval '5 minutes'))
                UNION ALL
                SELECT occurred_at AS "occurredAt", value, unit
                FROM telemetry_records
                WHERE organization_id = $1 AND device_id = $2 AND metric = $3
                  AND occurred_at >= GREATEST($4, time_bucket('5 minutes', now() - interval '5 minutes'))
                  AND occurred_at <= $5
                 ORDER BY "occurredAt"${rowLimit}`;
      }
      return `SELECT bucket AS "occurredAt", avg_temperature_celsius AS value, 'celsius' AS unit
              FROM telemetry_temperature_1h
              WHERE organization_id = $1 AND device_id = $2
                AND bucket >= $4
                AND bucket < time_bucket('1 hour', LEAST($5, now() - interval '1 hour'))
              UNION ALL
              SELECT occurred_at AS "occurredAt", value, unit
              FROM telemetry_records
              WHERE organization_id = $1 AND device_id = $2 AND metric = $3
                AND occurred_at >= GREATEST($4, time_bucket('1 hour', now() - interval '1 hour'))
                AND occurred_at <= $5
               ORDER BY "occurredAt"${rowLimit}`;
    }

    if (metric === 'relayState') {
      if (resolution === '5m') {
        return `SELECT last_sample_at AS "occurredAt", last_state::double precision AS value, 'boolean' AS unit
                FROM telemetry_relay_5m
                WHERE organization_id = $1 AND device_id = $2
                  AND bucket >= $4
                  AND bucket < time_bucket('5 minutes', LEAST($5, now() - interval '5 minutes'))
                UNION ALL
                SELECT occurred_at AS "occurredAt", value, unit
                FROM telemetry_records
                WHERE organization_id = $1 AND device_id = $2 AND metric = $3
                  AND occurred_at >= GREATEST($4, time_bucket('5 minutes', now() - interval '5 minutes'))
                  AND occurred_at <= $5
                 ORDER BY "occurredAt"${rowLimit}`;
      }
      return `SELECT last_sample_at AS "occurredAt", last_state::double precision AS value, 'boolean' AS unit
              FROM telemetry_relay_1h
              WHERE organization_id = $1 AND device_id = $2
                AND bucket >= $4
                AND bucket < time_bucket('1 hour', LEAST($5, now() - interval '1 hour'))
              UNION ALL
              SELECT occurred_at AS "occurredAt", value, unit
              FROM telemetry_records
              WHERE organization_id = $1 AND device_id = $2 AND metric = $3
                AND occurred_at >= GREATEST($4, time_bucket('1 hour', now() - interval '1 hour'))
                AND occurred_at <= $5
               ORDER BY "occurredAt"${rowLimit}`;
    }

    throw new BadRequestException(
      'Aggregated telemetry is only available for temperature and relayState.',
    );
  }

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }

  private allowExport(subject: string): boolean {
    const environment = readEnvironment(process.env);
    const now = Date.now();
    const windowStart = now - environment.TELEMETRY_EXPORT_RATE_WINDOW_MS;
    const attempts = (this.exportAttempts.get(subject) ?? []).filter(
      (attempt) => attempt > windowStart,
    );
    if (attempts.length >= environment.TELEMETRY_EXPORT_RATE_LIMIT) {
      this.exportAttempts.set(subject, attempts);
      return false;
    }
    attempts.push(now);
    this.exportAttempts.set(subject, attempts);
    return true;
  }

  private allowCommand(subject: string): boolean {
    const environment = readEnvironment(process.env);
    const now = Date.now();
    const windowStart = now - environment.COMMAND_RATE_WINDOW_MS;
    const attempts = (this.commandAttempts.get(subject) ?? []).filter(
      (attempt) => attempt > windowStart,
    );
    if (attempts.length >= environment.COMMAND_RATE_LIMIT) {
      this.commandAttempts.set(subject, attempts);
      return false;
    }
    attempts.push(now);
    this.commandAttempts.set(subject, attempts);
    return true;
  }

  private encodeCursor(device: DeviceCursor): string {
    return Buffer.from(
      JSON.stringify({
        name: device.name,
        externalId: device.externalId,
        id: device.id,
      }),
    ).toString('base64url');
  }

  private decodeCursor(cursor: string): DeviceCursor {
    try {
      const decoded: unknown = JSON.parse(
        Buffer.from(cursor, 'base64url').toString('utf8'),
      );
      if (
        !decoded ||
        typeof decoded !== 'object' ||
        typeof (decoded as DeviceCursor).name !== 'string' ||
        typeof (decoded as DeviceCursor).externalId !== 'string' ||
        typeof (decoded as DeviceCursor).id !== 'string' ||
        !(decoded as DeviceCursor).name ||
        !(decoded as DeviceCursor).externalId ||
        !(decoded as DeviceCursor).id
      ) {
        throw new Error('Invalid cursor');
      }
      return decoded as DeviceCursor;
    } catch {
      throw new BadRequestException('Cursor is invalid.');
    }
  }

  private async writeAudit(
    organizationId: string,
    actorSubject: string | null,
    action: string,
    resourceType: string,
    resourceId: string,
    result: 'allowed' | 'denied',
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await this.database.query(
      `INSERT INTO audit_events
         (organization_id, actor_id, action, resource_type, resource_id, result, metadata)
       VALUES ($1, (SELECT id FROM users WHERE subject = $2), $3, $4, $5, $6, $7::jsonb)`,
      [
        organizationId,
        actorSubject,
        action,
        resourceType,
        resourceId,
        result,
        JSON.stringify(metadata),
      ],
    );
  }

  private async find(
    organizationId: string,
    deviceId: string,
  ): Promise<Device> {
    const result = await this.database.query<Device>(
      `SELECT id, external_id AS "externalId", name, type,
              capability_version AS "capabilityVersion", status,
              last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM devices WHERE organization_id = $1 AND id = $2`,
      [organizationId, deviceId],
    );
    if (!result.rows[0]) throw new NotFoundException('Device was not found.');
    return result.rows[0];
  }

  private async requireCatalog(type: string, version: string) {
    const result = await this.database.query<CapabilityCatalog>(
      `SELECT device_type AS type, version, metrics, commands
       FROM device_capability_catalog WHERE device_type = $1 AND version = $2`,
      [type, version],
    );
    if (!result.rows[0]) {
      throw new BadRequestException(
        `No capability catalog exists for ${type} ${version}.`,
      );
    }
    return result.rows[0];
  }
}
