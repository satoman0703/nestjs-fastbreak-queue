import { Controller, Get, Inject } from '@nestjs/common';
import { APP_TYPE, type AppType } from '@/config/app-type.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(APP_TYPE) private readonly appType: AppType) {}

  @Get()
  check(): { status: 'ok'; appType: AppType } {
    return { status: 'ok', appType: this.appType };
  }
}
