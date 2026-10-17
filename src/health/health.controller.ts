import { Controller, Get } from '@nestjs/common';
import { AppType, getAppType } from '../config/app-type.js';

@Controller('health')
export class HealthController {
  @Get()
  check(): { status: 'ok'; appType: AppType } {
    return { status: 'ok', appType: getAppType() };
  }
}
