import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { EnqueueExportResponse, ExportResponse } from '@/export/dto/export-response.dto.js';
import {
  EXPORT_JOB_RETRY,
  EXPORT_QUEUE,
  type ExportJobData,
  type ExportJobName,
  exportBatchJobId,
  exportExecuteJobId,
} from '@/export/export.queue.js';
import { PrismaService } from '@/prisma/prisma.service.js';

/**
 * 成績表 CSV を Execute（シーズンごとに分けて Batch を積む）→ Batch → Complete（連結する）の 3 段で作る
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(EXPORT_QUEUE)
    private readonly exportQueue: Queue<ExportJobData, void, ExportJobName>,
  ) {}

  async enqueue(seasons: number[]): Promise<EnqueueExportResponse> {
    const { id, status } = await this.prisma.export.create({
      data: { seasons: [...new Set(seasons)].sort((a, b) => a - b) },
      select: { id: true, status: true },
    });
    // attempts を付けない（1 回だけ）。Batch を積んだ後に失敗してやり直すと、
    // removeOnComplete で消えた（終わった）Batch の jobId は重複扱いにならず、もう一度積まれて二重に数えるため
    await this.exportQueue.add(
      'execute',
      { exportId: id },
      { jobId: exportExecuteJobId(id), removeOnComplete: true, removeOnFail: true },
    );
    return { id, status };
  }

  async findById(id: string): Promise<ExportResponse> {
    const exp = await this.prisma.export.findUnique({
      where: { id },
      omit: { updatedAt: true, csv: true },
    });
    if (!exp) {
      throw new NotFoundException(`Export ${id} not found`);
    }
    return exp;
  }

  /**
   * 1 シーズン = 1 Batch に分けて積む。batchCount は Batch を積む前に書く。
   * 逆順だと、先に終わった Batch が batchCount を読めず、自分が最後かどうかを判定できない。
   * addBulk は 1 回の往復でまとめて積むので、途中まで積んで失敗することがない
   */
  async execute(exportId: string): Promise<void> {
    const { seasons } = await this.prisma.export.findUniqueOrThrow({ where: { id: exportId } });
    await this.prisma.export.update({
      where: { id: exportId },
      data: { status: 'PROCESSING', batchCount: seasons.length },
    });
    await this.exportQueue.addBulk(
      seasons.map((_, i) => ({
        name: 'batch' as const,
        data: { exportId, batchNumber: i + 1 },
        opts: {
          jobId: exportBatchJobId(exportId, i + 1),
          ...EXPORT_JOB_RETRY,
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
  }
}
