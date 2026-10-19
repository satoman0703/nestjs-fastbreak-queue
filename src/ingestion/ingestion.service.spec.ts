import { Test, type TestingModule } from '@nestjs/testing';
import { BalldontlieApiClient } from '@/balldontlie/balldontlie-api-client.service.js';
import { SLEEP, type Sleep } from '@/common/sleep.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { makeBdlGames } from '../../test/fixtures/bdl-game.js';
import { truncateAll } from '../../test/setup-db.js';

describe('IngestionService', () => {
  const fetchGamesPage = vi.fn<BalldontlieApiClient['fetchGamesPage']>();
  const sleep = vi.fn<Sleep>();
  let moduleRef: TestingModule;
  let service: IngestionService;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        IngestionService,
        PrismaService,
        { provide: BalldontlieApiClient, useValue: { fetchGamesPage } },
        { provide: SLEEP, useValue: sleep },
      ],
    }).compile();
    // init で PrismaService の onModuleInit（DB 接続）が呼ばれる
    await moduleRef.init();
    service = moduleRef.get(IngestionService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    fetchGamesPage.mockReset();
    sleep.mockReset().mockResolvedValue(undefined);
    fetchGamesPage.mockImplementation(async (_season, { cursor } = {}) =>
      cursor === undefined
        ? { games: makeBdlGames(1, 100), nextCursor: 100 }
        : { games: makeBdlGames(101, 30), nextCursor: null },
    );
  });

  afterAll(async () => {
    // close で PrismaService の onModuleDestroy（切断）が呼ばれる
    await moduleRef.close();
  });

  it('create は指定したシーズンの Ingestion を PENDING で作る', async () => {
    const ingestion = await service.create(2015);

    expect(ingestion).toMatchObject({ season: 2015, status: 'PENDING' });
  });

  it('全ページを取り込んで COMPLETED にし、開始・終了時刻を記録する', async () => {
    const { id } = await service.create(2015);

    await service.run(id);

    expect(await prisma.game.count()).toBe(130);
    expect(await prisma.team.count()).toBe(2);
    const ingestion = await prisma.ingestion.findUniqueOrThrow({ where: { id } });
    expect(ingestion).toMatchObject({ status: 'COMPLETED', gamesFetched: 130 });
    expect(ingestion.startedAt).toBeInstanceOf(Date);
    expect(ingestion.finishedAt!.getTime()).toBeGreaterThanOrEqual(ingestion.startedAt!.getTime());
  });

  it('前のページの nextCursor を次のページの cursor に渡す', async () => {
    const { id } = await service.create(2015);

    await service.run(id);

    expect(fetchGamesPage.mock.calls).toEqual([
      [2015, { cursor: undefined }],
      [2015, { cursor: 100 }],
    ]);
  });

  it('5 回/分を守るため、次のページを叩く前に 12 秒待つ（最後のページの後は待たない）', async () => {
    const { id } = await service.create(2015);

    await service.run(id);

    expect(sleep.mock.calls).toEqual([[12_000]]);
  });

  it('同じシーズンを 2 回取り込んでも試合は重複しない', async () => {
    await service.run((await service.create(2015)).id);
    await service.run((await service.create(2015)).id);

    expect(await prisma.game.count()).toBe(130);
  });
});
