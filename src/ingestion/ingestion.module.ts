import { Module } from '@nestjs/common';
import { BalldontlieApiClient } from '@/balldontlie/balldontlie-api-client.service.js';
import { SLEEP, sleep } from '@/common/sleep.js';
import { IngestionController } from '@/ingestion/ingestion.controller.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';

@Module({
  controllers: [IngestionController],
  providers: [IngestionService, BalldontlieApiClient, { provide: SLEEP, useValue: sleep }],
})
export class IngestionModule {}
