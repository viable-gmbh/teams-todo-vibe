import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'crypto';
import type { Request } from 'express';

@Injectable()
export class SessionAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request & { userId?: string }>();
    const userId = this.getUserIdFromAuthHeader(request.headers.authorization);
    if (!userId) {
      throw new UnauthorizedException('Login required.');
    }
    request.userId = userId;
    return true;
  }

  private getUserIdFromAuthHeader(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    return this.validateAuthToken(token);
  }

  private validateAuthToken(token: string): string | null {
    const parts = token.split('.');
    if (parts.length !== 2) {
      return null;
    }
    const [encodedPayload, providedSignature] = parts;
    if (!encodedPayload || !providedSignature) {
      return null;
    }

    const expectedSignature = this.signTokenPayload(encodedPayload);
    const providedBuffer = Buffer.from(providedSignature, 'utf-8');
    const expectedBuffer = Buffer.from(expectedSignature, 'utf-8');
    if (
      providedBuffer.length !== expectedBuffer.length ||
      !timingSafeEqual(providedBuffer, expectedBuffer)
    ) {
      return null;
    }

    try {
      const parsed = JSON.parse(Buffer.from(encodedPayload, 'base64url').toString('utf-8')) as {
        uid?: unknown;
        exp?: unknown;
      };
      if (typeof parsed.uid !== 'string' || typeof parsed.exp !== 'number') {
        return null;
      }
      if (parsed.exp <= Math.floor(Date.now() / 1000)) {
        return null;
      }
      return parsed.uid;
    } catch {
      return null;
    }
  }

  private signTokenPayload(encodedPayload: string): string {
    const secret = process.env.AUTH_TOKEN_SECRET ?? process.env.SESSION_SECRET;
    if (!secret || secret.trim().length < 16) {
      return '';
    }
    return createHmac('sha256', secret).update(encodedPayload).digest('base64url');
  }
}
