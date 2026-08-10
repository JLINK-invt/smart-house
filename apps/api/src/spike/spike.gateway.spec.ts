const mockRedis = {
  subscribe: jest.fn(),
  on: jest.fn(),
  quit: jest.fn(),
};

jest.mock('ioredis', () => ({
  __esModule: true,
  default: jest.fn(() => mockRedis),
}));

import { SpikeGateway } from './spike.gateway';
import type { IdentityService } from '../identity/identity.service';
import type { OrganizationsService } from '../organizations/organizations.service';

const identity = { subject: 'user-1', email: 'user@example.com', roles: [] };

function client(accessToken: unknown = 'token') {
  return {
    id: 'socket-1',
    handshake: { auth: { accessToken } },
    join: jest.fn().mockResolvedValue(undefined),
    disconnect: jest.fn(),
  };
}

function gateway(organizations = ['organization-1']) {
  return new SpikeGateway(
    {
      verify: jest.fn().mockResolvedValue(identity),
    } as unknown as IdentityService,
    {
      activeOrganizationIds: jest.fn().mockResolvedValue(organizations),
    } as unknown as OrganizationsService,
  );
}

describe('SpikeGateway', () => {
  beforeEach(() => jest.clearAllMocks());

  it('rejects clients with invalid tokens', async () => {
    const verify = jest.fn().mockRejectedValue(new Error('invalid token'));
    const instance = new SpikeGateway(
      { verify } as unknown as IdentityService,
      {} as OrganizationsService,
    );
    const socket = client();

    await instance.handleConnection(socket);

    expect(socket.disconnect).toHaveBeenCalled();
  });

  it('joins only the authenticated client organizations', async () => {
    const instance = gateway(['organization-1']);
    const socket = client();

    await instance.handleConnection(socket);

    expect(socket.join).toHaveBeenCalledWith('organization:organization-1');
    expect(socket.join).not.toHaveBeenCalledWith('organization:organization-2');
  });

  it('authorizes device subscriptions within an active organization only', async () => {
    const instance = gateway(['organization-1']);
    const socket = client();
    await instance.handleConnection(socket);
    socket.join.mockClear();

    await expect(
      instance.handleSubscription(socket, {
        organizationId: 'organization-2',
        deviceId: 'device-1',
      }),
    ).resolves.toEqual({ ok: false });
    expect(socket.join).not.toHaveBeenCalled();

    await expect(
      instance.handleSubscription(socket, {
        organizationId: 'organization-1',
        deviceId: 'device-1',
      }),
    ).resolves.toEqual({ ok: true });
    expect(socket.join).toHaveBeenCalledWith(
      'organization:organization-1:device:device-1',
    );
  });

  it('rejects invalid Redis event envelopes', () => {
    const instance = gateway();
    const emit = jest.fn();
    instance.server = { to: jest.fn(() => ({ emit })) } as never;

    (
      instance as never as { handleRedisMessage: (payload: string) => void }
    ).handleRedisMessage('{"organizationId":"organization-1"}');

    expect(emit).not.toHaveBeenCalled();
  });

  it('emits a persisted Redis event to its tenant and device rooms', () => {
    const instance = gateway();
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    instance.server = { to } as never;
    const event = {
      eventId: 'event-1',
      correlationId: 'message-1',
      metric: 'temperature',
      organizationId: 'organization-1',
      telemetry: { deviceId: 'device-1' },
    };

    (
      instance as never as { handleRedisMessage: (payload: string) => void }
    ).handleRedisMessage(JSON.stringify(event));

    expect(to).toHaveBeenCalledWith([
      'organization:organization-1',
      'organization:organization-1:device:device-1',
    ]);
    expect(emit).toHaveBeenCalledWith('telemetry.persisted', event);
  });

  it('validates and emits command status events to authorized rooms', () => {
    const instance = gateway();
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    instance.server = { to } as never;
    const event = {
      eventId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
      deviceId: '44444444-4444-4444-8444-444444444444',
      command: {
        id: '22222222-2222-4222-8222-222222222222',
        type: 'relay.set',
        status: 'acknowledged',
        expiresAt: '2026-01-01T00:05:00.000Z',
        createdAt: '2026-01-01T00:00:00.000Z',
        error: null,
      },
    };

    (
      instance as never as {
        handleCommandStatusMessage: (payload: string) => void;
      }
    ).handleCommandStatusMessage(JSON.stringify(event));

    expect(to).toHaveBeenCalledWith([
      'organization:33333333-3333-4333-8333-333333333333',
      'organization:33333333-3333-4333-8333-333333333333:device:44444444-4444-4444-8444-444444444444',
    ]);
    expect(emit).toHaveBeenCalledWith('command.status', event);
  });

  it('validates and emits alert status events to authorized rooms', () => {
    const instance = gateway();
    const emit = jest.fn();
    const to = jest.fn(() => ({ emit }));
    instance.server = { to } as never;
    const event = {
      eventId: '11111111-1111-4111-8111-111111111111',
      correlationId: '22222222-2222-4222-8222-222222222222',
      organizationId: '33333333-3333-4333-8333-333333333333',
      deviceId: '44444444-4444-4444-8444-444444444444',
      alert: {
        id: '22222222-2222-4222-8222-222222222222',
        ruleId: '55555555-5555-4555-8555-555555555555',
        deviceId: '44444444-4444-4444-8444-444444444444',
        metric: 'temperature',
        observedValue: 30,
        observedAt: '2026-01-01T00:00:00.000Z',
        message: 'High temperature',
        severity: 'high',
        state: 'acknowledged',
        openedAt: '2026-01-01T00:00:00.000Z',
        resolvedAt: null,
      },
    };

    (
      instance as never as {
        handleAlertStatusMessage: (payload: string) => void;
      }
    ).handleAlertStatusMessage(JSON.stringify(event));

    expect(to).toHaveBeenCalledWith([
      'organization:33333333-3333-4333-8333-333333333333',
      'organization:33333333-3333-4333-8333-333333333333:device:44444444-4444-4444-8444-444444444444',
    ]);
    expect(emit).toHaveBeenCalledWith('alert.status', event);
  });
});
