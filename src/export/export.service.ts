import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { Prisma } from '@/generated/prisma/client.js';
import { PrismaService } from '@/prisma/prisma.service.js';

/**
 * 試合 CSV を Execute（試合の id を件数で分けて Batch を積む）→ Batch → Complete（連結する）の 3 段で作る
 */
@Injectable()
export class ExportService {
  private readonly logger = new Logger(ExportService.name);

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

  /**
   * ジョブ名で 3 段に振り分ける。最終試行で失敗したらエクスポートを FAILED にし、例外は投げ直す。
   * PROCESSING のまま残ると、終わった Batch の数が batchCount に届かず Complete が積まれないので、処理中に見え続ける。
   * 例外を握りつぶすと、BullMQ が成功と判断してリトライしなくなる
   * @param options.isFinalAttempt 失敗したらもうリトライされないか（execute は attempts を付けないので常に true）
   */
  async runJob(
    name: ExportJobName,
    { exportId, batchNumber, gameIds }: ExportJobData,
    { isFinalAttempt }: { isFinalAttempt: boolean },
  ): Promise<void> {
    try {
      switch (name) {
        case 'execute':
          return await this.execute(exportId);
        case 'batch':
          // batch のジョブは execute が必ず batchNumber と gameIds を付けて積む
          return await this.runBatch({ exportId, batchNumber: batchNumber!, gameIds: gameIds! });
        case 'complete':
          return await this.complete(exportId);
      }
    } catch (error) {
      if (isFinalAttempt) {
        await this.markFailed(exportId, error);
      }
      throw error;
    }
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
   * +1 した後、完了を BullMQ に返す前に落ちると同じ Batch がもう一度動く。そこで +1 すると、残りの Batch が終わる前に
   * Complete が動いて試合の抜けた CSV ができるので、ExportPart の create と +1 を 1 つのトランザクションにし、
   * ExportPart がもうあれば（主キー違反）数え終わっているとして +1 しない。保存と数を同じ DB に置いているので、ロックは要らない。
   * ほかの Batch が最終試行で失敗して FAILED になっていたら、もう完成しないので何もしない。
   * 例外を投げるとこの Batch までリトライされるので、正常に終わらせる
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
    const { status } = await this.prisma.export.findUniqueOrThrow({
      where: { id: exportId },
      select: { status: true },
    });
    if (status === 'FAILED') {
      this.logger.warn({
        message: 'ほかの Batch が失敗したので処理しません',
        exportId,
        batchNumber,
      });
      return;
    }
    const csv = await buildGamesCsv(this.prisma, gameIds, { withHeader: batchNumber === 1 });
    const { batchesCompleted, batchCount } = await this.saveAndCountBatch(
      exportId,
      batchNumber,
      csv,
    );
    if (batchesCompleted !== batchCount) {
      return;
    }
    // もう一度動いた Batch が、COMPLETED のエクスポートを FINALIZING に戻さないよう、PROCESSING のときだけ変える。
    // update だと条件に合わない（0 件）ときに例外になり、Batch が失敗扱いになるので updateMany を使う
    await this.prisma.export.updateMany({
      where: { id: exportId, status: 'PROCESSING' },
      data: { status: 'FINALIZING' },
    });
    // 前の試行が Complete を積む前に落ちた場合に備えて、もう一度動いた Batch も積む。
    // まだ残っていれば jobId で 1 つになり、もう終わっていれば complete は FINALIZING 以外では何もしない
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
   * @returns +1 した後の終わった数。前の試行で保存済みなら、+1 せずに今の数
   */
  private async saveAndCountBatch(
    exportId: string,
    batchNumber: number,
    csv: string,
  ): Promise<{ batchesCompleted: number; batchCount: number | null }> {
    const select = { batchesCompleted: true, batchCount: true } as const;
    try {
      return await this.prisma.$transaction(async (tx) => {
        await tx.exportPart.create({ data: { exportId, batchNumber, csv } });
        return tx.export.update({
          where: { id: exportId },
          data: { batchesCompleted: { increment: 1 } },
          select,
        });
      });
    } catch (error) {
      if (!(error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')) {
        throw error;
      }
      this.logger.warn({ message: '保存済みの Batch なので数えません', exportId, batchNumber });
      return this.prisma.export.findUniqueOrThrow({ where: { id: exportId }, select });
    }
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

  private async markFailed(exportId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      { message: `エクスポートに失敗しました: ${message}`, exportId },
      error instanceof Error ? error.stack : undefined,
    );
    await this.prisma.export.update({
      where: { id: exportId },
      data: { status: 'FAILED', error: message, finishedAt: new Date() },
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
