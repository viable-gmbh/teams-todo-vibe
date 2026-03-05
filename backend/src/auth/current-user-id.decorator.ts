import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

export const CurrentUserId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request & { session?: { userId?: string } }>();
    const userId = request.session?.userId;
    if (!userId) {
      throw new UnauthorizedException('Login required.');
    }
    return userId;
  },
);
