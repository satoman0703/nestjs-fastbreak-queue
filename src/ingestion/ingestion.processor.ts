import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { INGESTION_QUEUE, type IngestionJobData } from '@/ingestion/ingestion.queue.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';

/**
 * ingestion キューからジョブを取り出して取り込みを実行する。
 * providers に入っているだけで @nestjs/bullmq が Worker を起動するため、worker プロセスでだけ登録する（WorkerModule）
 */
@Processor(INGESTION_QUEUE)
export class IngestionProcessor extends WorkerHost {
  constructor(private readonly ingestionService: IngestionService) {
    super();
  }

  /**
   * run が投げた例外はそのまま投げ直す。握りつぶすと BullMQ がジョブを completed にしてしまう
   */
  async process(job: Job<IngestionJobData>): Promise<void> {
    await this.ingestionService.run(job.data.ingestionId);
  }
}
