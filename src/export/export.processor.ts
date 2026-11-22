import { Processor, WorkerHost } from '@nestjs/bullmq';
import type { Job } from 'bullmq';
import { EXPORT_QUEUE, type ExportJobData, type ExportJobName } from '@/export/export.queue.js';
import { ExportService } from '@/export/export.service.js';

/**
 * export キューのジョブを、ジョブ名で 3 段に振り分ける。
 * 取り込みと違って外部 API の制限が無く DB だけで終わるので、同時に 3 つまで処理する
 */
@Processor(EXPORT_QUEUE, { concurrency: 3 })
export class ExportProcessor extends WorkerHost {
  constructor(private readonly exportService: ExportService) {
    super();
  }

  async process(job: Job<ExportJobData, void, ExportJobName>): Promise<void> {
    const { exportId, batchNumber, gameIds } = job.data;
    switch (job.name) {
      case 'execute':
        return this.exportService.execute(exportId);
      case 'batch':
        // batch のジョブは execute が必ず batchNumber と gameIds を付けて積む
        return this.exportService.runBatch({
          exportId,
          batchNumber: batchNumber!,
          gameIds: gameIds!,
        });
      case 'complete':
        return this.exportService.complete(exportId);
    }
  }
}
