import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import type { OrganizationsService } from '../organizations/organizations.service';
import { AlertsService } from './alerts.service';

const query = jest.fn();
const end = jest.fn();

jest.mock('pg', () => ({
  Pool: jest.fn(() => ({ query, end })),
}));

const identity = { subject: 'user-1', email: 'user@example.com', roles: [] };
const input = {
  type: 'threshold' as const,
  name: 'High kitchen temperature',
  deviceId: '2d77bf2a-cad4-4951-ae4c-9b21de4b11fe',
  metric: 'temperature',
  operator: 'gt' as const,
  threshold: 30,
  durationSeconds: 120,
  hysteresis: 1.5,
  cooldownSeconds: 300,
  severity: 'high' as const,
};

describe('AlertsService', () => {
  const requireMembership = jest.fn();
  const organizations = {
    requireMembership,
  } as unknown as OrganizationsService;
  let service: AlertsService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new AlertsService(organizations);
  });

  it('allows owners and admins to create a rule only for a scoped catalog metric', async () => {
    requireMembership.mockResolvedValue({ role: 'admin' });
    query
      .mockResolvedValueOnce({
        rows: [{ type: 'temperature_sensor', capabilityVersion: 'v1' }],
      })
      .mockResolvedValueOnce({ rows: [{ metrics: ['temperature'] }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'rule-1', ...input, enabled: true }],
      });

    await expect(
      service.createRule(identity, 'organization-1', input),
    ).resolves.toMatchObject({
      id: 'rule-1',
      metric: 'temperature',
    });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining(
        'FROM devices WHERE organization_id = $1 AND id = $2',
      ),
      ['organization-1', input.deviceId],
    );
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO alert_rules'),
      [
        'organization-1',
        input.name,
        'threshold',
        ...Object.values(input).slice(2),
      ],
    );
  });

  it('rejects non-managers before querying devices', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });

    await expect(
      service.createRule(identity, 'organization-1', input),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });

  it('rejects a foreign device and a metric outside the device catalog', async () => {
    requireMembership.mockResolvedValue({ role: 'owner' });
    query.mockResolvedValueOnce({ rows: [] });
    await expect(
      service.createRule(identity, 'organization-1', input),
    ).rejects.toBeInstanceOf(NotFoundException);

    query.mockReset();
    query
      .mockResolvedValueOnce({
        rows: [{ type: 'relay', capabilityVersion: 'v1' }],
      })
      .mockResolvedValueOnce({ rows: [{ metrics: ['relayState'] }] });
    await expect(
      service.createRule(identity, 'organization-1', input),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('lists rules and alert incidents only after membership is confirmed', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    query
      .mockResolvedValueOnce({ rows: [{ id: 'rule-1' }] })
      .mockResolvedValueOnce({
        rows: [{ id: 'alert-1', state: 'open' }],
      });

    await expect(
      service.listRules(identity, 'organization-1'),
    ).resolves.toEqual([{ id: 'rule-1' }]);
    await expect(
      service.listAlerts(identity, 'organization-1'),
    ).resolves.toEqual([{ id: 'alert-1', state: 'open' }]);
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('FROM alerts WHERE organization_id = $1'),
      ['organization-1', null, null],
    );
  });

  it('lets operators transition an alert while recording audit and realtime outbox data', async () => {
    requireMembership.mockResolvedValue({ role: 'operator' });
    query.mockResolvedValueOnce({
      rows: [{ id: 'alert-1', state: 'acknowledged' }],
    });

    await expect(
      service.transitionAlert(
        identity,
        'organization-1',
        'alert-1',
        'acknowledge',
      ),
    ).resolves.toMatchObject({ id: 'alert-1', state: 'acknowledged' });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO alert_transitions'),
      expect.arrayContaining([
        'organization-1',
        'alert-1',
        identity.subject,
        'acknowledged',
        ['open'],
        'alert.acknowledge',
      ]),
    );
    expect(query).toHaveBeenLastCalledWith(
      expect.stringContaining('INSERT INTO alert_transitions'),
      expect.any(Array),
    );
  });

  it('prevents viewers from transitioning alerts', async () => {
    requireMembership.mockResolvedValue({ role: 'viewer' });
    await expect(
      service.transitionAlert(identity, 'organization-1', 'alert-1', 'resolve'),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(query).not.toHaveBeenCalled();
  });
});
