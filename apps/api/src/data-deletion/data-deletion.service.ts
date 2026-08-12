import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  OnModuleDestroy,
} from '@nestjs/common';
import { Pool } from 'pg';
import { readEnvironment } from '../config/environment';
import type { Identity } from '../identity/identity.service';
import { OrganizationsService } from '../organizations/organizations.service';

type DeletionJob = {
  id: string;
  status: 'pending' | 'processing' | 'completed' | 'dead_letter';
  attempts: number;
  createdAt: string;
  completedAt: string | null;
  lastError: string | null;
};

@Injectable()
export class DataDeletionService implements OnModuleDestroy {
  private readonly database = new Pool({
    connectionString: readEnvironment(process.env).DATABASE_URL,
  });

  constructor(private readonly organizations: OrganizationsService) {}

  async onModuleDestroy(): Promise<void> {
    await this.database.end();
  }

  async request(
    identity: Identity,
    organizationId: string,
  ): Promise<DeletionJob> {
    const membership = await this.organizations.requireMembership(
      identity,
      organizationId,
    );
    if (membership.role !== 'owner') {
      throw new ForbiddenException('Only owners can delete organization data.');
    }
    const result = await this.database.query<DeletionJob>(
      `WITH actor AS (
         SELECT id FROM users WHERE subject = $2
       ), job AS (
         INSERT INTO tenant_data_deletion_jobs (organization_id, requested_by)
         SELECT $1, id FROM actor
         ON CONFLICT (organization_id) WHERE status IN ('pending', 'processing') DO NOTHING
         RETURNING id, status, attempts, created_at AS "createdAt", completed_at AS "completedAt", last_error AS "lastError"
       ), audit AS (
         INSERT INTO audit_events (organization_id, actor_id, action, resource_type, resource_id, result, correlation_id, metadata)
         SELECT $1, actor.id, 'organization.data_deletion.request', 'tenant_data_deletion_job', job.id::text,
                'allowed', job.id, jsonb_build_object('scope', 'all_tenant_operational_data')
         FROM job CROSS JOIN actor
       )
       SELECT * FROM job`,
      [organizationId, identity.subject],
    );
    if (!result.rows[0]) {
      throw new ConflictException(
        'A tenant data deletion job is already active.',
      );
    }
    return result.rows[0];
  }

  async status(
    identity: Identity,
    organizationId: string,
    jobId: string,
  ): Promise<DeletionJob> {
    const result = await this.database.query<DeletionJob>(
      `SELECT id, status, attempts, created_at AS "createdAt", completed_at AS "completedAt", last_error AS "lastError"
       FROM tenant_data_deletion_jobs j JOIN users u ON u.id = j.requested_by
       WHERE j.id = $1 AND j.organization_id = $2 AND u.subject = $3`,
      [jobId, organizationId, identity.subject],
    );
    if (!result.rows[0])
      throw new NotFoundException('Data deletion job was not found.');
    return result.rows[0];
  }
}
