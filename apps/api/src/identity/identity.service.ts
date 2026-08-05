import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { readEnvironment } from '../config/environment';

export type Identity = {
  subject: string;
  email: string;
  roles: string[];
};

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);
  private readonly environment = readEnvironment(process.env);

  async verify(accessToken: string): Promise<Identity> {
    try {
      const { createRemoteJWKSet, jwtVerify } = await import('jose');
      const keys = createRemoteJWKSet(
        new URL(
          `${this.environment.KEYCLOAK_ISSUER}/protocol/openid-connect/certs`,
        ),
      );
      const { payload } = await jwtVerify(accessToken, keys, {
        issuer: this.environment.KEYCLOAK_ISSUER,
        audience: this.environment.KEYCLOAK_AUDIENCE,
      });
      if (
        typeof payload.sub !== 'string' ||
        typeof payload.email !== 'string'
      ) {
        throw new UnauthorizedException(
          'Token is missing required identity claims.',
        );
      }
      const realmAccess = payload.realm_access as
        { roles?: unknown } | undefined;
      return {
        subject: payload.sub,
        email: payload.email,
        roles: Array.isArray(realmAccess?.roles)
          ? realmAccess.roles.filter(
              (role): role is string => typeof role === 'string',
            )
          : [],
      };
    } catch (error) {
      if (error instanceof UnauthorizedException) throw error;
      this.logger.warn(
        `JWT verification failed: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
      throw new UnauthorizedException('Invalid access token.');
    }
  }
}
