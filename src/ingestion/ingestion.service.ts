import { Inject, Injectable } from '@nestjs/common';
import { BalldontlieApiClient } from '@/balldontlie/balldontlie-api-client.service.js';
import type { BdlGame } from '@/balldontlie/balldontlie.types.js';
import { SLEEP, type Sleep } from '@/common/sleep.js';
import type { Ingestion } from '@/generated/prisma/client.js';
import { toGameData, toTeamData } from '@/ingestion/game-mapper.js';
import { PrismaService } from '@/prisma/prisma.service.js';

/**
 * 無料プランは 5 リクエスト/分なので、1 リクエストごとに 12 秒空ける
 */
const REQUEST_INTERVAL_MS = 12_000;

/**
 * 1 シーズン分の試合を balldontlie から取り込む。
 * キューに依存しない形にして、同期エンドポイントからも worker からも同じ処理を呼べるようにする
 */
@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly balldontlieApiClient: BalldontlieApiClient,
    @Inject(SLEEP) private readonly sleep: Sleep,
  ) {}

  async create(season: number): Promise<Ingestion> {
    return this.prisma.ingestion.create({ data: { season } });
  }

  async run(ingestionId: string): Promise<void> {
    const { season } = await this.prisma.ingestion.update({
      where: { id: ingestionId },
      data: { status: 'RUNNING', startedAt: new Date() },
    });

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

    await this.prisma.ingestion.update({
      where: { id: ingestionId },
      data: { status: 'COMPLETED', finishedAt: new Date() },
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
