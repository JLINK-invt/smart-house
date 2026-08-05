import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import { createHash, randomBytes } from 'node:crypto';
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

type Device = DeviceInput & {
  id: string;
  status: string;
  lastSeenAt: string | null;
  createdAt: string;
  updatedAt: string;
};

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

@Injectable()
export class DevicesService implements OnModuleDestroy {
  private readonly database = new Pool({
    connectionString: readEnvironment(process.env).DATABASE_URL,
  });

  constructor(private readonly organizations: OrganizationsService) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async list(identity: Identity, organizationId: string): Promise<Device[]> {
    await this.organizations.requireMembership(identity, organizationId);
    const result = await this.database.query<Device>(
      `SELECT id, external_id AS "externalId", name, type,
              capability_version AS "capabilityVersion", status,
              last_seen_at AS "lastSeenAt", created_at AS "createdAt", updated_at AS "updatedAt"
       FROM devices WHERE organization_id = $1 ORDER BY name, external_id`,
      [organizationId],
    );
    return result.rows;
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
  ) {
    await this.requireManager(identity, organizationId);
    const device = await this.find(organizationId, deviceId);
    const catalog = await this.requireCatalog(
      device.type,
      device.capabilityVersion,
    );
    if (!catalog.commands.includes(commandType)) {
      throw new BadRequestException(
        `Command ${commandType} is not supported by this device.`,
      );
    }
    const result = await this.database.query<{ id: string; type: string }>(
      `INSERT INTO commands (organization_id, device_id, type, payload, nonce, expires_at)
       VALUES ($1, $2, $3, $4::jsonb, $5, now() + interval '5 minutes')
       RETURNING id, type`,
      [
        organizationId,
        deviceId,
        commandType,
        JSON.stringify(payload ?? {}),
        crypto.randomUUID(),
      ],
    );
    return result.rows[0];
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

  private hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
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
