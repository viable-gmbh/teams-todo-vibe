import { IsOptional, IsString, MinLength } from 'class-validator';

export class UpdateSettingsDto {
  @IsOptional()
  @IsString()
  @MinLength(8)
  todoistApiKey?: string;

  @IsOptional()
  @IsString()
  @MinLength(8)
  openaiApiKey?: string;
}
