import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { session?: { userId?: string } }>();
    const userId = request.session?.userId;
    if (!userId) {
      throw new UnauthorizedException('Login required.');
    }
    return true;
  }
}
