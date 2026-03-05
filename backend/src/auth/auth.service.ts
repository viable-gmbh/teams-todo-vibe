import { Injectable, InternalServerErrorException, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
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

  constructor(
    private readonly configService: ConfigService,
    private readonly prismaService: PrismaService,
  ) {}

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
}
