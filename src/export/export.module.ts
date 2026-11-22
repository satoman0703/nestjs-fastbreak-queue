import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ExportController } from '@/export/export.controller.js';
import { EXPORT_BATCH_SIZE, EXPORT_QUEUE } from '@/export/export.queue.js';
import { ExportService } from '@/export/export.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: EXPORT_QUEUE })],
  controllers: [ExportController],
  // 1 シーズン約 1300 試合なので、1 シーズンが 3 つの Batch に分かれる程度にする
  providers: [ExportService, { provide: EXPORT_BATCH_SIZE, useValue: 500 }],
  exports: [ExportService],
})
export class ExportModule {}
