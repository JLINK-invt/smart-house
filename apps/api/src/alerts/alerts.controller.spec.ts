import { BadRequestException } from '@nestjs/common';
import type { AuthenticatedRequest } from '../identity/bearer-auth.guard';
import { AlertsController } from './alerts.controller';
import type { AlertsService } from './alerts.service';

describe('AlertsController', () => {
  const createRule = jest.fn();
  const listRules = jest.fn();
  const listAlerts = jest.fn();
  const transitionAlert = jest.fn();
  const alerts = {
    createRule,
    listRules,
    listAlerts,
    transitionAlert,
  } as unknown as AlertsService;
  const controller = new AlertsController(alerts);
  const request = {
    identity: { subject: 'user-1', email: 'user@example.com', roles: [] },
  } as unknown as AuthenticatedRequest;

  beforeEach(() => jest.clearAllMocks());

  it('validates and forwards a threshold alert rule', () => {
    void controller.createRule(request, 'organization-1', {
      name: ' High temperature ',
      deviceId: '2d77bf2a-cad4-4951-ae4c-9b21de4b11fe',
      metric: ' temperature ',
      operator: 'gt',
      threshold: 30,
      durationSeconds: 60,
      hysteresis: 0.5,
      cooldownSeconds: 120,
    });

    expect(createRule).toHaveBeenCalledWith(
      request.identity,
      'organization-1',
      {
        type: 'threshold',
        name: 'High temperature',
        deviceId: '2d77bf2a-cad4-4951-ae4c-9b21de4b11fe',
        metric: 'temperature',
        operator: 'gt',
        threshold: 30,
        durationSeconds: 60,
        hysteresis: 0.5,
        cooldownSeconds: 120,
        severity: 'medium',
      },
    );
  });

  it('rejects malformed threshold alert rules', () => {
    expect(() =>
      controller.createRule(request, 'organization-1', { threshold: '30' }),
    ).toThrow(BadRequestException);
    expect(createRule).not.toHaveBeenCalled();
  });

  it('forwards member list requests', () => {
    void controller.listRules(request, 'organization-1');
    void controller.listAlerts(request, 'organization-1', {});
    expect(listRules).toHaveBeenCalledWith(request.identity, 'organization-1');
    expect(listAlerts).toHaveBeenCalledWith(
      request.identity,
      'organization-1',
      {},
    );
  });

  it('validates and forwards lifecycle actions', () => {
    void controller.transitionAlert(
      request,
      'organization-1',
      'alert-1',
      'acknowledge',
    );
    expect(transitionAlert).toHaveBeenCalledWith(
      request.identity,
      'organization-1',
      'alert-1',
      'acknowledge',
    );
    expect(() =>
      controller.transitionAlert(
        request,
        'organization-1',
        'alert-1',
        'delete',
      ),
    ).toThrow(BadRequestException);
  });
});
