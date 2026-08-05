import { UnauthorizedException } from '@nestjs/common';
import { BearerAuthGuard } from './bearer-auth.guard';
import type { IdentityService } from './identity.service';

function contextFor(authorization?: string) {
  const request = { headers: { authorization } };
  return {
    switchToHttp: () => ({ getRequest: () => request }),
    request,
  };
}

describe('BearerAuthGuard', () => {
  it('rejects requests without a bearer token', async () => {
    const guard = new BearerAuthGuard({
      verify: jest.fn(),
    } as unknown as IdentityService);

    await expect(
      guard.canActivate(contextFor() as never),
    ).rejects.toBeInstanceOf(UnauthorizedException);
  });

  it('attaches the verified identity to the request', async () => {
    const verify = jest.fn().mockResolvedValue({
      subject: 'keycloak-user',
      email: 'owner@example.com',
      roles: ['owner'],
    });
    const guard = new BearerAuthGuard({ verify } as unknown as IdentityService);
    const context = contextFor('Bearer signed-token');

    await expect(guard.canActivate(context as never)).resolves.toBe(true);
    expect(verify).toHaveBeenCalledWith('signed-token');
    expect(context.request).toMatchObject({
      identity: { subject: 'keycloak-user' },
    });
  });
});
