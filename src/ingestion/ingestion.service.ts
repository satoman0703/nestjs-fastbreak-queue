import { InjectQueue } from '@nestjs/bullmq';
import { ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  BalldontlieApiClient,
  BalldontlieApiError,
} from '@/balldontlie/balldontlie-api-client.service.js';
import type { BdlGame } from '@/balldontlie/balldontlie.types.js';
import { SLEEP, type Sleep } from '@/common/sleep.js';
import type { Ingestion } from '@/generated/prisma/client.js';
import type {
  EnqueueIngestionResponse,
  IngestionResponse,
  SyncIngestionResponse,
} from '@/ingestion/dto/ingestion-response.dto.js';
import { toGameData, toTeamData } from '@/ingestion/game-mapper.js';
import {
  INGESTION_JOB_RETRY,
  INGESTION_QUEUE,
  type IngestionJobData,
  ingestionJobId,
  ingestionJobIdPrefix,
} from '@/ingestion/ingestion.queue.js';
import { PrismaService } from '@/prisma/prisma.service.js';

/**
 * 無料プランは 5 リクエスト/分なので、1 リクエストごとに 12 秒空ける
 */
const REQUEST_INTERVAL_MS = 12_000;

/**
 * 保存しようとしたページが、すでに別の試行で保存されていたことを表す。トランザクションを取り消すために投げる
 */
class PageAlreadySavedError extends Error {}

/**
 * 1 シーズン分の試合を balldontlie から取り込む。
 * run はキューに依存しない形にして、同期エンドポイントからも worker からも同じ処理を呼べるようにする
 */
@Injectable()
export class IngestionService {
  private readonly logger = new Logger(IngestionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly balldontlieApiClient: BalldontlieApiClient,
    @Inject(SLEEP) private readonly sleep: Sleep,
    @InjectQueue(INGESTION_QUEUE) private readonly ingestionQueue: Queue<IngestionJobData>,
  ) {}

  async create(season: number): Promise<Ingestion> {
    return this.prisma.ingestion.create({ data: { season } });
  }

  async findById(id: string): Promise<IngestionResponse> {
    const ingestion = await this.prisma.ingestion.findUnique({
      where: { id },
      omit: { updatedAt: true, cursor: true },
    });
    if (!ingestion) {
      throw new NotFoundException(`Ingestion ${id} not found`);
    }
    return ingestion;
  }

  /**
   * 取り込みをキューに積み、終わるのを待たずに返す。処理は worker が行う。
   * DB に行を作ってから積む。逆順だと、行ができる前に worker がジョブを取り、存在しない id を処理しようとする
   */
  async enqueue(season: number): Promise<EnqueueIngestionResponse> {
    await this.assertNotInProgress(season);
    const { id, status } = await this.create(season);
    try {
      await this.addPageJob(season, { ingestionId: id, cursor: null });
    } catch (error) {
      // 積めなかった行が PENDING のまま残ると、誰も処理しないのに待ち続けて見える
      await this.markFailed(id, error);
      throw error;
    }
    return { id, status };
  }

  /**
   * jobId で add の重複は防げるが、2 回目の POST は 202 を返したまま誰も処理しない行を残すため、行を作る前に断る。
   * ページごとのジョブは jobId が cursor で変わるので、1 件を id で取らず、待ち・実行中・リトライ待ちを全件取って先頭部分で探す。
   * 完了・失敗したジョブは removeOnComplete / removeOnFail で消えるので、見つかればチェーンの途中。
   * 確認と add の間に同じシーズンの POST が割り込むと両方ここを通る。そのときもジョブは jobId で 1 つになるが、片方の行は PENDING のまま残る
   */
  private async assertNotInProgress(season: number): Promise<void> {
    const prefix = ingestionJobIdPrefix(season);
    const jobs = await this.ingestionQueue.getJobs(['waiting', 'active', 'delayed', 'prioritized']);
    if (jobs.some((job) => job.id?.startsWith(prefix))) {
      throw new ConflictException(`Ingestion for season ${season} is already in progress`);
    }
  }

  private async addPageJob(season: number, data: IngestionJobData): Promise<void> {
    await this.ingestionQueue.add('ingest', data, {
      jobId: ingestionJobId(season, data.cursor),
      ...INGESTION_JOB_RETRY,
      // 同じ jobId のジョブが Redis に残っている間は add しても積まれない。
      // 完了・失敗したジョブを残すと、そのシーズンを二度と取り込み直せなくなるので消す
      removeOnComplete: true,
      removeOnFail: true,
    });
  }

  /**
   * 1 ページだけ取り込み、次のページのジョブを積む（worker 用）。
   * ページの保存と cursor の更新は同じトランザクションなので、DB の cursor がジョブの cursor と違えば、
   * そのページは前の試行で保存済み（保存した後、次を積む前に落ちた）。その場合は API も保存もせず、次を積み直すだけにする
   */
  async ingestPage(
    { ingestionId, cursor }: IngestionJobData,
    { isFinalAttempt }: { isFinalAttempt: boolean },
  ): Promise<void> {
    const ingestion = await this.prisma.ingestion.findUniqueOrThrow({ where: { id: ingestionId } });
    let nextCursor = ingestion.cursor;

    const alreadySaved = ingestion.cursor !== cursor || ingestion.status === 'COMPLETED';
    if (!alreadySaved) {
      try {
        if (ingestion.status === 'PENDING') {
          await this.prisma.ingestion.update({
            where: { id: ingestionId },
            data: {
              status: 'RUNNING',
              error: null,
              ...(ingestion.startedAt === null && { startedAt: new Date() }),
            },
          });
        }
        const page = await this.balldontlieApiClient.fetchGamesPage(ingestion.season, {
          cursor: cursor ?? undefined,
        });
        const saved = await this.savePage(ingestionId, page.games, {
          from: cursor,
          to: page.nextCursor,
        });
        // 同じページのジョブが同時に動き、先に保存された場合は、そちらが進めた cursor で次を積む
        nextCursor = saved
          ? page.nextCursor
          : (await this.prisma.ingestion.findUniqueOrThrow({ where: { id: ingestionId } })).cursor;
      } catch (error) {
        await (isFinalAttempt
          ? this.markFailed(ingestionId, error)
          : this.markRetrying(ingestionId, error));
        throw error;
      }
    }

    if (nextCursor !== null) {
      await this.addPageJob(ingestion.season, { ingestionId, cursor: nextCursor });
    }
  }

  /**
   * 取り込みが終わるまで待ってから、結果を返す同期版
   */
  async ingestSync(season: number): Promise<SyncIngestionResponse> {
    const { id } = await this.create(season);
    await this.run(id);
    return this.prisma.ingestion.findUniqueOrThrow({
      where: { id },
      select: { id: true, status: true, gamesFetched: true },
    });
  }

  /**
   * @param options.isFinalAttempt false なら、失敗しても FAILED にせず PENDING に戻す（worker がリトライする）。
   *   同期版はリトライしないので既定は true
   */
  async run(
    ingestionId: string,
    { isFinalAttempt = true }: { isFinalAttempt?: boolean } = {},
  ): Promise<void> {
    const { season } = await this.prisma.ingestion.update({
      where: { id: ingestionId },
      // 同期版は 1 ページ目から取り直すので、前回の試行で数えた件数と cursor、エラーを消す
      data: {
        status: 'RUNNING',
        startedAt: new Date(),
        gamesFetched: 0,
        cursor: null,
        error: null,
      },
    });

    try {
      let cursor: number | undefined;
      while (true) {
        const { games, nextCursor } = await this.balldontlieApiClient.fetchGamesPage(season, {
          cursor,
        });
        await this.savePage(ingestionId, games, { from: cursor ?? null, to: nextCursor });

        if (nextCursor === null) break;
        cursor = nextCursor;
        await this.sleep(REQUEST_INTERVAL_MS);
      }
    } catch (error) {
      await (isFinalAttempt
        ? this.markFailed(ingestionId, error)
        : this.markRetrying(ingestionId, error));
      // 握りつぶすと呼び出し側（同期 API や worker）が成功と区別できず、リトライの判断もできない
      throw error;
    }
  }

  /**
   * リトライ待ちの間に FAILED と見せると、まだ成功しうるのに失敗と判断されるため、待ちに戻す。
   * 何で失敗したかは見えるように error には残す
   */
  private async markRetrying(ingestionId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.warn({
      message: `取り込みに失敗しました。リトライします: ${message}`,
      ingestionId,
    });
    await this.prisma.ingestion.update({
      where: { id: ingestionId },
      data: { status: 'PENDING', error: message },
    });
  }

  /**
   * RUNNING のまま残ると、状態を見に来た人には処理中に見え続けるため、失敗として記録する。
   * それまでに保存したページは消さない（試合は upsert なので、取り込み直しても重複しない）
   */
  private async markFailed(ingestionId: string, error: unknown): Promise<void> {
    const message = error instanceof Error ? error.message : String(error);
    this.logger.error(
      {
        message: `取り込みに失敗しました: ${message}`,
        ingestionId,
        info: error instanceof BalldontlieApiError ? error.info : undefined,
      },
      error instanceof Error ? error.stack : undefined,
    );
    await this.prisma.ingestion.update({
      where: { id: ingestionId },
      data: { status: 'FAILED', error: message, finishedAt: new Date() },
    });
  }

  /**
   * 1 ページ分のチームと試合を保存し、取得件数を加算して cursor を進める。最後のページなら COMPLETED にする。
   * id は balldontlie の id なので upsert にすれば、同じページを再取得しても重複しない。
   * cursor が from のままのときだけ進める。読んでから書くまでの間に同じページを別の worker が保存していたら、
   * 条件に合う行が 0 になるので、トランザクションごと取り消して false を返す（件数を二重に数えない）
   * @returns 保存したら true、先に保存されていたら false
   */
  private async savePage(
    ingestionId: string,
    games: BdlGame[],
    { from, to }: { from: number | null; to: number | null },
  ): Promise<boolean> {
    const teams = new Map(
      games.flatMap((g) => [g.home_team, g.visitor_team]).map((t) => [t.id, toTeamData(t)]),
    );

    try {
      await this.prisma.$transaction(async (tx) => {
        // 先に Ingestion の行を更新して行ロックを取る。後から来たほうはここで待ち、先が commit した後の cursor で条件を判定される
        const { count } = await tx.ingestion.updateMany({
          where: { id: ingestionId, cursor: from },
          data: {
            gamesFetched: { increment: games.length },
            cursor: to,
            ...(to === null && { status: 'COMPLETED', finishedAt: new Date() }),
          },
        });
        if (count === 0) {
          throw new PageAlreadySavedError();
        }
        for (const team of teams.values()) {
          await tx.team.upsert({ where: { id: team.id }, create: team, update: team });
        }
        for (const game of games.map(toGameData)) {
          await tx.game.upsert({ where: { id: game.id }, create: game, update: game });
        }
      });
      return true;
    } catch (error) {
      if (error instanceof PageAlreadySavedError) {
        return false;
      }
      throw error;
    }
  }
}
