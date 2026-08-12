import {
  ConflictException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { OrganizationsService } from '../organizations/organizations.service';
import { DataDeletionService } from './data-deletion.service';

const query = jest.fn();
const end = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query, end })),
}));

const identity = { subject: 'owner-1', email: 'owner@example.com', roles: [] };

describe('DataDeletionService', () => {
  const requireMembership = jest.fn();
  const organizations = {
    requireMembership,
  } as unknown as OrganizationsService;
  let service: DataDeletionService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DataDeletionService(organizations);
  });

  it('queues an auditable deletion job only for the owner tenant', async () => {
    requireMembership.mockResolvedValue({ role: 'owner' });
    query.mockResolvedValueOnce({
      rows: [{ id: 'job-1', status: 'pending', attempts: 0 }],
    });

    await expect(
      service.request(identity, 'organization-1'),
    ).resolves.toMatchObject({
      id: 'job-1',
      status: 'pending',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('organization.data_deletion.request'),
      ['organization-1', identity.subject],
    );
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        "ON CONFLICT (organization_id) WHERE status IN ('pending', 'processing')",
      ),
      ['organization-1', identity.subject],
    );
  });

  it('rejects non-owners before creating a job', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    await expect(
      service.request(identity, 'organization-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('does not disclose a deletion job from another tenant', async () => {
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      service.status(identity, 'organization-1', 'foreign-job'),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('j.id = $1 AND j.organization_id = $2'),
      ['foreign-job', 'organization-1', identity.subject],
    );
  });

  it('reports an already active job without creating another', async () => {
    requireMembership.mockResolvedValue({ role: 'owner' });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      service.request(identity, 'organization-1'),
    ).rejects.toBeInstanceOf(ConflictException);
  });
});
