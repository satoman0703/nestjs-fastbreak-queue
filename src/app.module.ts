import { Module } from '@nestjs/common';
import { HealthController } from '@/health/health.controller.js';
import { IngestionModule } from '@/ingestion/ingestion.module.js';
import { PrismaModule } from '@/prisma/prisma.module.js';

@Module({
  imports: [PrismaModule, IngestionModule],
  controllers: [HealthController],
})
export class AppModule {}
