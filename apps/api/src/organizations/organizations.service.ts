import {
  ForbiddenException,
  Injectable,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import type { Identity } from '../identity/identity.service';
import { readEnvironment } from '../config/environment';

type Membership = { organizationId: string; role: string };

@Injectable()
export class OrganizationsService implements OnModuleDestroy {
  private readonly database = new Pool({
    connectionString: readEnvironment(process.env).DATABASE_URL,
  });

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async list(identity: Identity) {
    const userId = await this.ensureDefaultMembership(identity);
    const result = await this.database.query<{
      id: string;
      name: string;
      role: string;
    }>(
      `SELECT o.id, o.name, m.role FROM memberships m
       JOIN organizations o ON o.id = m.organization_id
       WHERE m.user_id = $1 AND m.status = 'active' ORDER BY o.name`,
      [userId],
    );
    return result.rows;
  }

  async activeOrganizationIds(identity: Identity): Promise<string[]> {
    return (await this.list(identity)).map((organization) => organization.id);
  }

  async userId(identity: Identity): Promise<string> {
    return this.upsertUser(identity);
  }

  async create(identity: Identity, name: string) {
    const userId = await this.upsertUser(identity);
    const organization = await this.database.query<{
      id: string;
      name: string;
    }>('INSERT INTO organizations (name) VALUES ($1) RETURNING id, name', [
      name,
    ]);
    await this.database.query(
      "INSERT INTO memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')",
      [organization.rows[0].id, userId],
    );
    return { ...organization.rows[0], role: 'owner' };
  }

  async members(identity: Identity, organizationId: string) {
    await this.requireMembership(identity, organizationId);
    const result = await this.database.query<{
      email: string;
      role: string;
      status: string;
    }>(
      `SELECT u.email, m.role, m.status FROM memberships m
       JOIN users u ON u.id = m.user_id WHERE m.organization_id = $1 ORDER BY u.email`,
      [organizationId],
    );
    return result.rows;
  }

  async addMember(
    identity: Identity,
    organizationId: string,
    email: string,
    role: string,
  ) {
    const actor = await this.requireMembership(identity, organizationId);
    if (!['owner', 'admin'].includes(actor.role)) {
      throw new ForbiddenException(
        'Only owners and admins can manage members.',
      );
    }
    if (!['admin', 'operator', 'viewer'].includes(role)) {
      throw new ForbiddenException('The requested role is not assignable.');
    }
    const user = await this.database.query<{ id: string }>(
      'SELECT id FROM users WHERE email = $1',
      [email],
    );
    if (!user.rows[0]) {
      throw new ForbiddenException(
        'The invited user must first register with Keycloak.',
      );
    }
    await this.database.query(
      `INSERT INTO memberships (organization_id, user_id, role, status) VALUES ($1, $2, $3, 'active')
       ON CONFLICT (organization_id, user_id) DO UPDATE SET role = EXCLUDED.role, status = 'active'`,
      [organizationId, user.rows[0].id, role],
    );
  }

  private async upsertUser(identity: Identity): Promise<string> {
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO users (subject, email) VALUES ($1, $2)
       ON CONFLICT (subject) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
      [identity.subject, identity.email],
    );
    return result.rows[0].id;
  }

  private async ensureDefaultMembership(identity: Identity): Promise<string> {
    const client = await this.database.connect();
    try {
      await client.query('BEGIN');
      // Serialize first-login initialization per Keycloak subject.
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        identity.subject,
      ]);
      const user = await client.query<{ id: string }>(
        `INSERT INTO users (subject, email) VALUES ($1, $2)
         ON CONFLICT (subject) DO UPDATE SET email = EXCLUDED.email RETURNING id`,
        [identity.subject, identity.email],
      );
      const userId = user.rows[0].id;
      const membership = await client.query<{ exists: boolean }>(
        'SELECT EXISTS(SELECT 1 FROM memberships WHERE user_id = $1) AS "exists"',
        [userId],
      );

      if (!membership.rows[0].exists) {
        const organization = await client.query<{ id: string }>(
          'INSERT INTO organizations (name) VALUES ($1) RETURNING id',
          ['Personal organization'],
        );
        await client.query(
          "INSERT INTO memberships (organization_id, user_id, role, status) VALUES ($1, $2, 'owner', 'active')",
          [organization.rows[0].id, userId],
        );
      }

      await client.query('COMMIT');
      return userId;
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }

  async requireMembership(
    identity: Identity,
    organizationId: string,
  ): Promise<Membership> {
    const userId = await this.upsertUser(identity);
    const result = await this.database.query<Membership>(
      `SELECT m.organization_id AS "organizationId", m.role FROM memberships m
       JOIN organizations o ON o.id = m.organization_id AND o.deleted_at IS NULL
       WHERE m.organization_id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [organizationId, userId],
    );
    if (!result.rows[0])
      throw new ForbiddenException('Organization access is denied.');
    return result.rows[0];
  }
}
