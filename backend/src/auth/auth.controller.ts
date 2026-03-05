import { BadRequestException, Controller, Get, Query, Res } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request, Response } from 'express';
import { Req } from '@nestjs/common';
import { AuthService } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly configService: ConfigService,
  ) {}

  @Get('login')
  async login(@Res() response: Response): Promise<void> {
    const url = await this.authService.getLoginUrl();
    response.redirect(url);
  }

  @Get('callback')
  async callback(
    @Query('code') code: string,
    @Req() request: Request & { session?: { userId?: string } },
    @Res() response: Response,
  ): Promise<void> {
    if (!code) {
      throw new BadRequestException('Missing OAuth code.');
    }
    const { userId } = await this.authService.handleAuthCallback(code);
    if (request.session) {
      request.session.userId = userId;
    }
    const frontendUrl = this.configService.get<string>('FRONTEND_URL', 'http://localhost:5173');
    response.redirect(`${frontendUrl}?connected=1`);
  }

  @Get('status')
  async status(
    @Req() request: Request & { session?: { userId?: string } },
  ): Promise<{ authenticated: boolean; expiresAt: string | null }> {
    return this.authService.getAuthStatus(request.session?.userId ?? null);
  }
}
