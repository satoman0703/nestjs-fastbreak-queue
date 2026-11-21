import { BullModule } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ExportController } from '@/export/export.controller.js';
import { EXPORT_QUEUE } from '@/export/export.queue.js';
import { ExportService } from '@/export/export.service.js';

@Module({
  imports: [BullModule.registerQueue({ name: EXPORT_QUEUE })],
  controllers: [ExportController],
  providers: [ExportService],
  exports: [ExportService],
})
export class ExportModule {}
