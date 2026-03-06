import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, timingSafeEqual } from 'crypto';
import {
  AccountInfo,
  AuthenticationResult,
  ConfidentialClientApplication,
  Configuration,
} from '@azure/msal-node';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class AuthService {
  private client: ConfidentialClientApplication | null = null;
  private readonly authTokenTtlSeconds: number;

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {
    const configuredTtl = Number(this.configService.get<string>('AUTH_TOKEN_TTL_SECONDS'));
    this.authTokenTtlSeconds =
      Number.isFinite(configuredTtl) && configuredTtl > 0 ? Math.floor(configuredTtl) : 7 * 24 * 60 * 60;
  }

  issueAuthToken(userId: string): string {
    const payload = {
      uid: userId,
      exp: Math.floor(Date.now() / 1000) + this.authTokenTtlSeconds,
    };
    const encodedPayload = Buffer.from(JSON.stringify(payload), 'utf-8').toString('base64url');
    const signature = this.signTokenPayload(encodedPayload);
    return `${encodedPayload}.${signature}`;
  }

  getUserIdFromAuthHeader(authHeader: string | undefined): string | null {
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return null;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    return this.validateAuthToken(token);
  }

  async getAuthStatusFromAuthHeader(
    authHeader: string | undefined,
  ): Promise<{ authenticated: boolean; expiresAt: string | null }> {
    const userId = this.getUserIdFromAuthHeader(authHeader);
    if (!userId) {
      return { authenticated: false, expiresAt: null };
    }
    return this.getAuthStatus(userId);
  }

  private getClient(): ConfidentialClientApplication {
    if (this.client) {
      return this.client;
    }
    const clientId = this.configService.get<string>('MS_CLIENT_ID');
    const clientSecret = this.configService.get<string>('MS_CLIENT_SECRET');
    const tenantId = this.configService.get<string>('MS_TENANT_ID');

    if (!clientId || !clientSecret || !tenantId) {
      throw new InternalServerErrorException('Missing Microsoft OAuth configuration.');
    }

    const msalConfig: Configuration = {
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret,
      },
    };

    this.client = new ConfidentialClientApplication(msalConfig);
    return this.client;
  }

  private getScopes(): string[] {
    return [
      'offline_access',
      'Chat.Read',
      'Chat.ReadWrite',
      'ChatMessage.Read',
      'ChatMessage.Send',
      'User.Read',
    ];
  }

  async getLoginUrl(): Promise<string> {
    const redirectUri = this.configService.get<string>('MS_REDIRECT_URI');
    if (!redirectUri) {
      throw new InternalServerErrorException('Missing MS_REDIRECT_URI configuration.');
    }

    return this.getClient().getAuthCodeUrl({
      scopes: this.getScopes(),
      redirectUri,
      prompt: 'select_account',
    });
  }

  async handleAuthCallback(code: string): Promise<{ userId: string }> {
    const redirectUri = this.configService.get<string>('MS_REDIRECT_URI');
    if (!redirectUri) {
      throw new InternalServerErrorException('Missing MS_REDIRECT_URI configuration.');
    }

    const response = await this.getClient().acquireTokenByCode({
      code,
      scopes: this.getScopes(),
      redirectUri,
    });

    const refreshToken = (response as { refreshToken?: string } | null)?.refreshToken;
    if (!response?.accessToken || !response.expiresOn) {
      throw new UnauthorizedException('Microsoft authentication failed.');
    }

    const msUserId = response.account?.localAccountId ?? response.account?.homeAccountId;
    if (!msUserId) {
      throw new UnauthorizedException('Microsoft account identifier unavailable.');
    }
    const existing = await this.prismaService.user.findUnique({ where: { msUserId } });
    if (existing) {
      const updated = await this.prismaService.user.update({
        where: { id: existing.id },
        data: {
          msUserId,
          msAccessToken: response.accessToken,
          msRefreshToken: refreshToken ?? existing.msRefreshToken,
          msTokenExpiry: response.expiresOn,
        },
      });
      return { userId: updated.id };
    }

    const created = await this.prismaService.user.create({
      data: {
        msUserId,
        msAccessToken: response.accessToken,
        msRefreshToken: refreshToken ?? '',
        msTokenExpiry: response.expiresOn,
      },
    });
    return { userId: created.id };
  }

  async getAuthStatus(userId: string | null): Promise<{ authenticated: boolean; expiresAt: string | null }> {
    if (!userId) {
      return { authenticated: false, expiresAt: null };
    }
    const user = await this.prismaService.user.findUnique({ where: { id: userId } });
    return {
      authenticated: !!user,
      expiresAt: user?.msTokenExpiry.toISOString() ?? null,
    };
  }

  async getValidAccessToken(userId: string, forceRefresh = false): Promise<string> {
    const user = await this.prismaService.user.findUnique({ where: { id: userId } });
    if (!user) {
      throw new UnauthorizedException('Microsoft account not connected.');
    }

    const needsRefresh =
      forceRefresh || user.msTokenExpiry.getTime() - Date.now() < 5 * 60 * 1000;
    if (!needsRefresh) {
      return user.msAccessToken;
    }
    const silentResult = await this.tryAcquireTokenSilent(user.msUserId);
    if (silentResult?.accessToken && silentResult.expiresOn) {
      await this.prismaService.user.update({
        where: { id: user.id },
        data: {
          msAccessToken: silentResult.accessToken,
          msTokenExpiry: silentResult.expiresOn,
        },
      });
      return silentResult.accessToken;
    }

    if (!user.msRefreshToken) {
      throw new UnauthorizedException('Refresh token unavailable. Reconnect Microsoft account.');
    }

    const refreshed = await this.getClient().acquireTokenByRefreshToken({
      refreshToken: user.msRefreshToken,
      scopes: this.getScopes(),
    });

    const refreshedToken = (refreshed as { refreshToken?: string } | null)?.refreshToken;
    if (!refreshed?.accessToken || !refreshed.expiresOn) {
      throw new UnauthorizedException('Unable to refresh Microsoft token.');
    }

    await this.prismaService.user.update({
      where: { id: user.id },
      data: {
        msAccessToken: refreshed.accessToken,
        msRefreshToken: refreshedToken ?? user.msRefreshToken,
        msTokenExpiry: refreshed.expiresOn,
      },
    });

    return refreshed.accessToken;
  }

  private async tryAcquireTokenSilent(msUserId: string | null): Promise<AuthenticationResult | null> {
    if (!msUserId) {
      return null;
    }
    const account = await this.resolveAccountFromCache(msUserId);
    if (!account) {
      return null;
    }
    try {
      return await this.getClient().acquireTokenSilent({
        account,
        scopes: this.getScopes(),
        forceRefresh: true,
      });
    } catch {
      return null;
    }
  }

  private async resolveAccountFromCache(msUserId: string): Promise<AccountInfo | null> {
    const accounts = await this.getClient().getTokenCache().getAllAccounts();
    return (
      accounts.find(
        (account) => account.localAccountId === msUserId || account.homeAccountId === msUserId,
      ) ?? null
    );
  }

  private signTokenPayload(encodedPayload: string): string {
    return createHmac('sha256', this.getAuthTokenSecret()).update(encodedPayload).digest('base64url');
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

  private getAuthTokenSecret(): string {
    const secret =
      this.configService.get<string>('AUTH_TOKEN_SECRET') ??
      this.configService.get<string>('SESSION_SECRET');
    if (!secret || secret.trim().length < 16) {
      throw new InternalServerErrorException(
        'AUTH_TOKEN_SECRET (or SESSION_SECRET) must be configured with at least 16 characters.',
      );
    }
    return secret;
  }
}
