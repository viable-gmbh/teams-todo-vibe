import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { decryptAes256, encryptAes256 } from '../common/crypto.util';

@Injectable()
export class SettingsService {
  private readonly defaultReactionEmoji = 'wrench';
  private readonly defaultCompletionReplyDe = 'Erledigt.';
  private readonly defaultCompletionReplyEn = 'Done.';

  constructor(
    private readonly prismaService: PrismaService,
    private readonly configService: ConfigService,
  ) {}

  async getSettings(userId: string) {
    const keys = await this.getDecryptedKeys(userId);
    const settings = await this.prismaService.settings.findUnique({ where: { userId } });
    return {
      openaiApiKeyHint: keys.openaiApiKey ? `****${keys.openaiApiKey.slice(-4)}` : null,
      reactionEmoji: this.normalizeReactionEmoji(settings?.reactionEmoji) ?? this.defaultReactionEmoji,
      completionReplyDe: settings?.completionReplyDe?.trim() || this.defaultCompletionReplyDe,
      completionReplyEn: settings?.completionReplyEn?.trim() || this.defaultCompletionReplyEn,
    };
  }

  async updateSettings(userId: string, payload: UpdateSettingsDto) {
    if (
      !payload.openaiApiKey &&
      payload.reactionEmoji === undefined &&
      payload.completionReplyDe === undefined &&
      payload.completionReplyEn === undefined
    ) {
      return this.getSettings(userId);
    }
    const secret = this.configService.get<string>('SESSION_SECRET', 'dev-session-secret');
    const openaiEncrypted = payload.openaiApiKey
      ? encryptAes256(payload.openaiApiKey, secret)
      : undefined;

    const current = await this.prismaService.settings.findUnique({ where: { userId } });
    if (current) {
      await this.prismaService.settings.update({
        where: { id: current.id },
        data: {
          ...(openaiEncrypted ? { openaiKeyEnc: openaiEncrypted } : {}),
          ...(payload.reactionEmoji !== undefined
            ? {
                reactionEmoji:
                  this.normalizeReactionEmoji(payload.reactionEmoji) ?? this.defaultReactionEmoji,
              }
            : {}),
          ...(payload.completionReplyDe !== undefined
            ? {
                completionReplyDe:
                  this.normalizeOptionalText(payload.completionReplyDe) ??
                  this.defaultCompletionReplyDe,
              }
            : {}),
          ...(payload.completionReplyEn !== undefined
            ? {
                completionReplyEn:
                  this.normalizeOptionalText(payload.completionReplyEn) ??
                  this.defaultCompletionReplyEn,
              }
            : {}),
        },
      });
    } else {
      await this.prismaService.settings.create({
        data: {
          userId,
          openaiKeyEnc: openaiEncrypted,
          reactionEmoji:
            this.normalizeReactionEmoji(payload.reactionEmoji) ?? this.defaultReactionEmoji,
          completionReplyDe:
            this.normalizeOptionalText(payload.completionReplyDe) ??
            this.defaultCompletionReplyDe,
          completionReplyEn:
            this.normalizeOptionalText(payload.completionReplyEn) ??
            this.defaultCompletionReplyEn,
        },
      });
    }
    return this.getSettings(userId);
  }

  async getOpenAiApiKey(userId: string): Promise<string | null> {
    const keys = await this.getDecryptedKeys(userId);
    return keys.openaiApiKey;
  }

  private async getDecryptedKeys(userId: string): Promise<{ openaiApiKey: string | null }> {
    const settings = await this.prismaService.settings.findUnique({ where: { userId } });
    if (!settings) {
      return { openaiApiKey: null };
    }

    const secret = this.configService.get<string>(
      'SESSION_SECRET',
      'dev-session-secret',
    );
    return {
      openaiApiKey: settings.openaiKeyEnc
        ? decryptAes256(settings.openaiKeyEnc, secret)
        : null,
    };
  }

  private normalizeOptionalText(value?: string | null): string | null {
    if (typeof value !== 'string') {
      return null;
    }
    const trimmed = value.trim();
    return trimmed.length > 0 ? trimmed : null;
  }

  private normalizeReactionEmoji(value?: string | null): 'thumbsup' | 'heart' | 'wrench' | null {
    const normalized = this.normalizeOptionalText(value)?.toLowerCase();
    if (!normalized) {
      return null;
    }
    if (normalized === 'thumbsup' || normalized === 'heart' || normalized === 'wrench') {
      return normalized;
    }
    return this.defaultReactionEmoji;
  }
}
