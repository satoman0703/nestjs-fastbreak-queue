import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type { EnqueueExportResponse, ExportResponse } from '@/export/dto/export-response.dto.js';
import {
  EXPORT_BATCH_SIZE,
  EXPORT_JOB_RETRY,
  EXPORT_QUEUE,
  type ExportJobData,
  type ExportJobName,
  exportBatchJobId,
  exportCompleteJobId,
  exportExecuteJobId,
} from '@/export/export.queue.js';
import { buildGamesCsv } from '@/export/games-csv.js';
import { PrismaService } from '@/prisma/prisma.service.js';

/**
 * 試合 CSV を Execute（試合の id を件数で分けて Batch を積む）→ Batch → Complete（連結する）の 3 段で作る
 */
@Injectable()
export class ExportService {
  constructor(
    private readonly prisma: PrismaService,
    @InjectQueue(EXPORT_QUEUE)
    private readonly exportQueue: Queue<ExportJobData, void, ExportJobName>,
    @Inject(EXPORT_BATCH_SIZE) private readonly batchSize: number,
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
   * 対象の試合の id を CSV に出す順（日付順）で全部引き、batchSize 件ずつに分けて Batch を積む。
   * 試合が 0 件でもヘッダだけの CSV を作れるよう、Batch は最低 1 つ積む。
   * batchCount は Batch を積む前に書く。逆順だと、先に終わった Batch が batchCount を読めず、自分が最後かどうかを判定できない。
   * addBulk は 1 回の往復でまとめて積むので、途中まで積んで失敗することがない
   */
  async execute(exportId: string): Promise<void> {
    const { seasons } = await this.prisma.export.findUniqueOrThrow({ where: { id: exportId } });
    const gameIds = (
      await this.prisma.game.findMany({
        where: { season: { in: seasons } },
        select: { id: true },
        orderBy: [{ date: 'asc' }, { id: 'asc' }],
      })
    ).map((game) => game.id);
    const batchCount = Math.max(1, Math.ceil(gameIds.length / this.batchSize));
    await this.prisma.export.update({
      where: { id: exportId },
      data: { status: 'PROCESSING', batchCount },
    });
    await this.exportQueue.addBulk(
      Array.from({ length: batchCount }, (_, i) => ({
        name: 'batch' as const,
        data: {
          exportId,
          batchNumber: i + 1,
          gameIds: gameIds.slice(i * this.batchSize, (i + 1) * this.batchSize),
        },
        opts: {
          jobId: exportBatchJobId(exportId, i + 1),
          ...EXPORT_JOB_RETRY,
          removeOnComplete: true,
          removeOnFail: true,
        },
      })),
    );
  }

  /**
   * 渡された試合の CSV を保存し、終わった Batch の数を +1 する。+1 した後の値が batchCount と等しい Batch だけが Complete を積む。
   * 読んでから +1 を書くと、同時に終わった Batch がどちらも「自分は最後ではない」と判断して Complete が積まれないため、
   * DB の increment（UPDATE ... SET x = x + 1 RETURNING）の戻り値で判定する。
   * 保存した後、+1 する前に落ちたリトライでも ExportPart が主キー違反にならないよう upsert にする。
   * +1 した後、ジョブの完了を BullMQ に返す前に落ちると、リトライで二重に +1 する（5 章で直す）
   */
  async runBatch({
    exportId,
    batchNumber,
    gameIds,
  }: {
    exportId: string;
    batchNumber: number;
    gameIds: number[];
  }): Promise<void> {
    const csv = await buildGamesCsv(this.prisma, gameIds, { withHeader: batchNumber === 1 });
    await this.prisma.exportPart.upsert({
      where: { exportId_batchNumber: { exportId, batchNumber } },
      create: { exportId, batchNumber, csv },
      update: { csv },
    });

    const { batchesCompleted, batchCount } = await this.prisma.export.update({
      where: { id: exportId },
      data: { batchesCompleted: { increment: 1 } },
      select: { batchesCompleted: true, batchCount: true },
    });
    if (batchesCompleted !== batchCount) {
      return;
    }
    await this.prisma.export.update({ where: { id: exportId }, data: { status: 'FINALIZING' } });
    await this.exportQueue.add(
      'complete',
      { exportId },
      {
        jobId: exportCompleteJobId(exportId),
        ...EXPORT_JOB_RETRY,
        removeOnComplete: true,
        removeOnFail: true,
      },
    );
  }

  /**
   * Batch の CSV を batchNumber の順に連結する。
   * FINALIZING 以外（失敗した、もう連結した）のエクスポートを連結し直さないよう、状態を見てから動く
   */
  async complete(exportId: string): Promise<void> {
    const exp = await this.prisma.export.findUniqueOrThrow({
      where: { id: exportId },
      include: { parts: { orderBy: { batchNumber: 'asc' } } },
    });
    if (exp.status !== 'FINALIZING') {
      return;
    }
    await this.prisma.export.update({
      where: { id: exportId },
      data: {
        status: 'COMPLETED',
        csv: exp.parts.map((part) => part.csv).join(''),
        finishedAt: new Date(),
      },
    });
  }

  async getCsv(id: string): Promise<string> {
    const exp = await this.prisma.export.findUnique({
      where: { id },
      select: { status: true, csv: true },
    });
    if (!exp) {
      throw new NotFoundException(`Export ${id} not found`);
    }
    if (exp.status !== 'COMPLETED' || exp.csv === null) {
      throw new ConflictException(`Export ${id} is ${exp.status}`);
    }
    return exp.csv;
  }
}
