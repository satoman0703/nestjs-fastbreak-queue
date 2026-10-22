import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { BalldontlieApiClient } from '@/balldontlie/balldontlie-api-client.service.js';
import { SLEEP, sleep } from '@/common/sleep.js';
import { IngestionController } from '@/ingestion/ingestion.controller.js';
import { INGESTION_QUEUE } from '@/ingestion/ingestion.queue.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: INGESTION_QUEUE })],
  controllers: [IngestionController],
  providers: [IngestionService, BalldontlieApiClient, { provide: SLEEP, useValue: sleep }],
  exports: [IngestionService],
})
export class IngestionModule {}
