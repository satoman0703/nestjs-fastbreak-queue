import { Module } from '@nestjs/common';
import { IngestionProcessor } from '@/ingestion/ingestion.processor.js';
import { IngestionModule } from '@/ingestion/ingestion.module.js';

/**
 * APP_TYPE=worker のときだけ読み込む。どのキューを消費するかはここにまとめる
 */
@Module({
  imports: [IngestionModule],
  providers: [IngestionProcessor],
})
export class WorkerModule {}
