import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EXPORT_QUEUE, type ExportJobData, type ExportJobName } from '@/export/export.queue.js';
import { ExportService } from '@/export/export.service.js';

/**
 * export キューのジョブを取り出して、execute / batch / complete を実行する。
 * 取り込みと違って外部 API の制限が無く DB だけで終わるので、同時に 3 つまで処理する
 */
@Processor(EXPORT_QUEUE, { concurrency: 3 })
export class ExportProcessor extends WorkerHost {
  constructor(private readonly exportService: ExportService) {
    super();
  }

  /**
   * attemptsMade は「これまでに失敗した回数」なので、実行中の試行は attemptsMade + 1 回目。
   * execute は attempts を付けない（BullMQ が 0 を入れる）ので、常に最終試行になる
   */
  async process(job: Job<ExportJobData, void, ExportJobName>): Promise<void> {
    const isFinalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    await this.exportService.runJob(job.name, job.data, { isFinalAttempt });
  }
}
