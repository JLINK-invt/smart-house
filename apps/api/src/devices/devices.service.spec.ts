import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { DevicesService } from './devices.service';
import type { OrganizationsService } from '../organizations/organizations.service';

const query = jest.fn();
const end = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query, end })),
}));

const identity = { subject: 'user-1', email: 'user@example.com', roles: [] };
const device = {
  id: 'device-1',
  externalId: 'relay-1',
  name: 'Kitchen relay',
  type: 'relay',
  capabilityVersion: 'v1',
  status: 'inactive',
  lastSeenAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
};

describe('DevicesService', () => {
  const requireMembership = jest.fn();
  const organizations = {
    requireMembership,
  } as unknown as OrganizationsService;
  let service: DevicesService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new DevicesService(organizations);
  });

  it('lists devices only after confirming active organization membership', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    query.mockResolvedValue({ rows: [device] });

    await expect(service.list(identity, 'organization-1')).resolves.toEqual([
      device,
    ]);

    expect(requireMembership).toHaveBeenCalledWith(identity, 'organization-1');
    expect(query).toHaveBeenCalledWith(expect.any(String), ['organization-1']);
  });

  it('rejects device creation by non-manager roles', async () => {
    requireMembership.mockResolvedValue({ role: 'operator' });

    await expect(
      service.create(identity, 'organization-1', {
        externalId: 'relay-1',
        name: 'Kitchen relay',
        type: 'relay',
        capabilityVersion: 'v1',
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('updates only a device belonging to the requested organization', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValue({ rows: [device] });

    await service.update(identity, 'organization-1', 'device-1', {
      name: 'New name',
    });

    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('WHERE organization_id = $1 AND id = $2'),
      ['organization-1', 'device-1', 'New name'],
    );
  });

  it('reports a missing scoped device when disabling it', async () => {
    requireMembership.mockResolvedValue({ role: 'owner' });
    query.mockResolvedValue({ rows: [] });

    await expect(
      service.disable(identity, 'organization-1', 'missing'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('rejects registration against a type/version absent from the catalog', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValue({ rows: [] });

    await expect(
      service.create(identity, 'organization-1', {
        externalId: 'unknown-1',
        name: 'Unknown',
        type: 'unknown',
        capabilityVersion: 'v1',
      }),
    ).rejects.toThrow('No capability catalog exists');
  });

  it('rejects commands that are not in the registered device catalog', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValueOnce({ rows: [device] }).mockResolvedValueOnce({
      rows: [
        {
          type: 'relay',
          version: 'v1',
          metrics: ['relayState'],
          commands: ['relay.set'],
        },
      ],
    });

    await expect(
      service.createCommand(
        identity,
        'organization-1',
        'device-1',
        'relay.reset',
        {},
      ),
    ).rejects.toThrow('not supported');
    expect(query).toHaveBeenCalledTimes(2);
  });

  it('exchanges a valid activation token once and returns only non-secret references', async () => {
    query.mockResolvedValue({
      rows: [{ credentialReference: 'credential-1', deviceId: 'device-1' }],
    });

    await expect(
      service.exchangeActivationToken('token', 'device-1'),
    ).resolves.toEqual({
      deviceIdentity: 'device:device-1',
      credentialReference: 'credential-1',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('consumed_at IS NULL AND expires_at > now()'),
      [expect.any(String), 'device-1'],
    );
  });

  it('rejects a replayed activation token and writes a denial audit event', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'token-1',
            organizationId: 'organization-1',
            deviceId: 'device-1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      service.exchangeActivationToken('replayed', 'device-1'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO audit_events'),
      expect.arrayContaining(['organization-1', 'denied']),
    );
  });

  it('rejects an expired activation token', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'token-1',
            organizationId: 'organization-1',
            deviceId: 'device-1',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      service.exchangeActivationToken('expired', 'device-1'),
    ).rejects.toThrow('invalid, expired, or already used');
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('expires_at > now()'),
      [expect.any(String), 'device-1'],
    );
  });

  it('rejects a token presented for a device in another tenant', async () => {
    query
      .mockResolvedValueOnce({ rows: [] })
      .mockResolvedValueOnce({
        rows: [
          {
            id: 'token-1',
            organizationId: 'organization-a',
            deviceId: 'device-a',
          },
        ],
      })
      .mockResolvedValueOnce({ rows: [] });

    await expect(
      service.exchangeActivationToken('tenant-a-token', 'device-b'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO audit_events'),
      expect.arrayContaining(['organization-a', 'denied']),
    );
  });

  it('lists credential metadata without selecting secrets', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValueOnce({ rows: [device] }).mockResolvedValueOnce({
      rows: [
        {
          credentialReference: 'credential-1',
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
          revokedAt: null,
          status: 'active',
        },
      ],
    });

    await expect(
      service.listCredentials(identity, 'organization-1', 'device-1'),
    ).resolves.toHaveLength(1);
    expect(query).toHaveBeenLastCalledWith(
      expect.not.stringContaining('thumbprint'),
      ['organization-1', 'device-1'],
    );
  });

  it('rotates credentials by revoking active records and issuing one activation token', async () => {
    requireMembership.mockResolvedValue({ role: 'owner' });
    query.mockResolvedValueOnce({ rows: [device] }).mockResolvedValueOnce({
      rows: [
        {
          expiresAt: '2026-01-01T00:15:00.000Z',
          revokedCredentialReferences: ['credential-1'],
        },
      ],
    });

    await expect(
      service.rotateCredentials(identity, 'organization-1', 'device-1'),
    ).resolves.toMatchObject({
      deviceId: 'device-1',
      expiresAt: '2026-01-01T00:15:00.000Z',
      revokedCredentialReferences: ['credential-1'],
    });
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining("'device.credential.rotate'"),
      ['organization-1', 'device-1', expect.any(String), 'user-1'],
    );
  });

  it('revokes only an active credential in the requested organization and audits it', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query.mockResolvedValue({
      rows: [
        {
          credentialReference: 'credential-1',
          issuedAt: '2026-01-01T00:00:00.000Z',
          expiresAt: null,
          revokedAt: '2026-01-02T00:00:00.000Z',
          status: 'revoked',
        },
      ],
    });

    await expect(
      service.revokeCredential(
        identity,
        'organization-1',
        'device-1',
        'credential-1',
      ),
    ).resolves.toMatchObject({ status: 'revoked' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'organization_id = $1 AND device_id = $2 AND id = $3 AND revoked_at IS NULL',
      ),
      ['organization-1', 'device-1', 'credential-1', 'user-1'],
    );
  });
});
