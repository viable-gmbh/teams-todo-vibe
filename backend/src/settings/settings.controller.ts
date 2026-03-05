import { Body, Controller, Get, Patch, UseGuards } from '@nestjs/common';
import { SettingsService } from './settings.service';
import { UpdateSettingsDto } from './dto/update-settings.dto';
import { CurrentUserId } from '../auth/current-user-id.decorator';
import { SessionAuthGuard } from '../auth/session-auth.guard';

@UseGuards(SessionAuthGuard)
@Controller('settings')
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  getSettings(@CurrentUserId() userId: string) {
    return this.settingsService.getSettings(userId);
  }

  @Patch()
  updateSettings(@CurrentUserId() userId: string, @Body() payload: UpdateSettingsDto) {
    return this.settingsService.updateSettings(userId, payload);
  }
}
