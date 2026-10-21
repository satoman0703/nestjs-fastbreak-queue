import { InjectQueue } from '@nestjs/bullmq';
import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
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
import { INGESTION_QUEUE, type IngestionJobData } from '@/ingestion/ingestion.queue.js';
import { PrismaService } from '@/prisma/prisma.service.js';

/**
 * 無料プランは 5 リクエスト/分なので、1 リクエストごとに 12 秒空ける
 */
const REQUEST_INTERVAL_MS = 12_000;

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
      omit: { updatedAt: true },
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
    const { id, status } = await this.create(season);
    try {
      await this.ingestionQueue.add('ingest', { ingestionId: id });
    } catch (error) {
      // 積めなかった行が PENDING のまま残ると、誰も処理しないのに待ち続けて見える
      await this.markFailed(id, error);
      throw error;
    }
    return { id, status };
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

  async run(ingestionId: string): Promise<void> {
    const { season } = await this.prisma.ingestion.update({
      where: { id: ingestionId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

    try {
      let cursor: number | undefined;
      while (true) {
        const { games, nextCursor } = await this.balldontlieApiClient.fetchGamesPage(season, {
          cursor,
        });
        await this.savePage(ingestionId, games);

        if (nextCursor === null) break;
        cursor = nextCursor;
        await this.sleep(REQUEST_INTERVAL_MS);
      }
    } catch (error) {
      await this.markFailed(ingestionId, error);
      // 握りつぶすと呼び出し側（同期 API や worker）が成功と区別できず、リトライの判断もできない
      throw error;
    }

    await this.prisma.ingestion.update({
      where: { id: ingestionId },
      data: { status: 'COMPLETED', finishedAt: new Date() },
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
   * 1 ページ分のチームと試合を保存し、取得件数を加算する。
   * id は balldontlie の id なので upsert にすれば、同じページを再取得しても重複しない
   */
  private async savePage(ingestionId: string, games: BdlGame[]): Promise<void> {
    const teams = new Map(
      games.flatMap((g) => [g.home_team, g.visitor_team]).map((t) => [t.id, toTeamData(t)]),
    );

    await this.prisma.$transaction(async (tx) => {
      for (const team of teams.values()) {
        await tx.team.upsert({ where: { id: team.id }, create: team, update: team });
      }
      for (const game of games.map(toGameData)) {
        await tx.game.upsert({ where: { id: game.id }, create: game, update: game });
      }
      await tx.ingestion.update({
        where: { id: ingestionId },
        data: { gamesFetched: { increment: games.length } },
      });
    });
  }
}
