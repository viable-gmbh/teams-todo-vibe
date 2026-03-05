import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { decryptAes256, encryptAes256 } from '../common/crypto.util';

@Injectable()
export class SettingsService {
  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getSettings() {
    const keys = await this.getDecryptedKeys();
    if (!keys.todoistApiKey && !keys.openaiApiKey) {
      return { todoistApiKeyHint: null, openaiApiKeyHint: null };
    }
    return {
      todoistApiKeyHint: keys.todoistApiKey ? `****${keys.todoistApiKey.slice(-4)}` : null,
      openaiApiKeyHint: keys.openaiApiKey ? `****${keys.openaiApiKey.slice(-4)}` : null,
    };
  }

  async updateSettings(payload: UpdateSettingsDto) {
    if (!payload.todoistApiKey && !payload.openaiApiKey) {
      return this.getSettings();
    }
    const secret = this.configService.get<string>('SESSION_SECRET', 'dev-session-secret');
    const todoistEncrypted = payload.todoistApiKey
      ? encryptAes256(payload.todoistApiKey, secret)
      : undefined;
    const openaiEncrypted = payload.openaiApiKey
      ? encryptAes256(payload.openaiApiKey, secret)
      : undefined;

    const current = await this.prismaService.settings.findFirst();
    if (current) {
      await this.prismaService.settings.update({
        where: { id: current.id },
        data: {
          ...(todoistEncrypted ? { todoistKeyEnc: todoistEncrypted } : {}),
          ...(openaiEncrypted ? { openaiKeyEnc: openaiEncrypted } : {}),
        },
      });
    } else {
      await this.prismaService.settings.create({
        data: {
          todoistKeyEnc: todoistEncrypted,
          openaiKeyEnc: openaiEncrypted,
        },
      });
    }
    return this.getSettings();
  }

  async getOpenAiApiKey(): Promise<string | null> {
    const keys = await this.getDecryptedKeys();
    return keys.openaiApiKey;
  }

  private async getDecryptedKeys(): Promise<{ todoistApiKey: string | null; openaiApiKey: string | null }> {
    const settings = await this.prismaService.settings.findFirst();
    if (!settings) {
      return { todoistApiKey: null, openaiApiKey: null };
    }

    const secret = this.configService.get<string>(
      'SESSION_SECRET',
      'dev-session-secret',
    );
    return {
      todoistApiKey: settings.todoistKeyEnc
        ? decryptAes256(settings.todoistKeyEnc, secret)
        : null,
      openaiApiKey: settings.openaiKeyEnc
        ? decryptAes256(settings.openaiKeyEnc, secret)
        : null,
    };
  }
}
