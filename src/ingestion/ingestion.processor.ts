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
   * 1 ジョブで 1 ページだけ取り込む。ingestPage が投げた例外はそのまま投げ直す。握りつぶすと BullMQ がジョブを completed にしてしまう。
   * attemptsMade は「これまでに失敗した回数」なので、実行中の試行は attemptsMade + 1 回目
   */
  async process(job: Job<IngestionJobData>): Promise<void> {
    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await this.ingestionService.ingestPage(job.data, { isFinalAttempt });
  }
}
