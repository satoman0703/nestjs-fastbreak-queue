import { Module } from '@nestjs/common';
import { ExportModule } from '@/export/export.module.js';
import { ExportProcessor } from '@/export/export.processor.js';
import { IngestionProcessor } from '@/ingestion/ingestion.processor.js';
import { IngestionModule } from '@/ingestion/ingestion.module.js';

/**
 * APP_TYPE=worker のときだけ読み込む。どのキューを消費するかはここにまとめる
 */
@Module({
  imports: [IngestionModule, ExportModule],
  providers: [IngestionProcessor, ExportProcessor],
})
export class WorkerModule {}
