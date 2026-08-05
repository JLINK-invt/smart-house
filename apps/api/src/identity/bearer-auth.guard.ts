import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import type { FastifyRequest } from 'fastify';
import { IdentityService, type Identity } from './identity.service';

export type AuthenticatedRequest = FastifyRequest & { identity: Identity };

@Injectable()
export class BearerAuthGuard implements CanActivate {
  constructor(private readonly identityService: IdentityService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const authorization = request.headers.authorization;
    if (!authorization?.startsWith('Bearer ')) {
      throw new UnauthorizedException('Bearer authentication is required.');
    }
    request.identity = await this.identityService.verify(
      authorization.slice(7),
    );
    return true;
  }
}
