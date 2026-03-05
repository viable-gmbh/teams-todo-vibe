import { IsIn, IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  openaiApiKey?: string;

  @IsOptional()
  @IsString()
  @IsIn(['thumbsup', 'heart', 'wrench'], {
    message: 'reactionEmoji must be one of: thumbsup, heart, wrench.',
  })
  reactionEmoji?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  completionReplyDe?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  completionReplyEn?: string;
}
