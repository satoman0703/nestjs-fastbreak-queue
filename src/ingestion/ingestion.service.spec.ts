import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  BalldontlieApiClient,
  BalldontlieApiError,
} from '@/balldontlie/balldontlie-api-client.service.js';
import { SLEEP, type Sleep } from '@/common/sleep.js';
import { INGESTION_QUEUE, ingestionJobId } from '@/ingestion/ingestion.queue.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { makeBdlGames } from '../../test/fixtures/bdl-game.js';
import { truncateAll } from '../../test/setup-db.js';

describe('IngestionService', () => {
  const fetchGamesPage = vi.fn<BalldontlieApiClient['fetchGamesPage']>();
  const sleep = vi.fn<Sleep>();
  const queueAdd = vi.fn();
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
        // 次のページのジョブを積んだかだけを見る
        { provide: getQueueToken(INGESTION_QUEUE), useValue: { add: queueAdd } },
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
    queueAdd.mockReset();
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

  describe('途中で失敗したとき', () => {
    beforeEach(() => {
      // 1 ページ目は成功し、2 ページ目でレート制限に引っかかる
      fetchGamesPage.mockImplementation(async (_season, { cursor } = {}) => {
        if (cursor === undefined) return { games: makeBdlGames(1, 100), nextCursor: 100 };
        throw new BalldontlieApiError('HTTP Error: 429', {
          url: 'https://api.balldontlie.io/v1/games',
          status: 429,
          data: 'Too Many Requests',
        });
      });
    });

    it('FAILED にしてエラー内容と終了時刻を残し、そこまでの件数は保存したままにする', async () => {
      const { id } = await service.create(2015);

      await service.run(id).catch(() => {});

      const ingestion = await prisma.ingestion.findUniqueOrThrow({ where: { id } });
      expect(ingestion).toMatchObject({
        status: 'FAILED',
        error: 'HTTP Error: 429',
        gamesFetched: 100,
      });
      expect(ingestion.finishedAt).toBeInstanceOf(Date);
      expect(await prisma.game.count()).toBe(100);
    });

    it('呼び出し側にも失敗を伝えるため、例外を投げ直す', async () => {
      const { id } = await service.create(2015);

      await expect(service.run(id)).rejects.toBeInstanceOf(BalldontlieApiError);
    });

    it('最終試行でなければ、失敗しても PENDING に戻してエラーを残し、終了時刻は入れない', async () => {
      const { id } = await service.create(2015);

      await service.run(id, { isFinalAttempt: false }).catch(() => {});

      const ingestion = await prisma.ingestion.findUniqueOrThrow({ where: { id } });
      expect(ingestion).toMatchObject({ status: 'PENDING', error: 'HTTP Error: 429' });
      expect(ingestion.finishedAt).toBeNull();
    });

    it('リトライで 1 ページ目からやり直しても、件数を二重に数えない', async () => {
      const { id } = await service.create(2015);
      await service.run(id, { isFinalAttempt: false }).catch(() => {});
      fetchGamesPage.mockImplementation(async (_season, { cursor } = {}) =>
        cursor === undefined
          ? { games: makeBdlGames(1, 100), nextCursor: 100 }
          : { games: makeBdlGames(101, 30), nextCursor: null },
      );

      await service.run(id);

      const ingestion = await prisma.ingestion.findUniqueOrThrow({ where: { id } });
      expect(ingestion).toMatchObject({ status: 'COMPLETED', gamesFetched: 130, error: null });
    });
  });

  describe('ingestPage（1 ジョブ = 1 ページ）', () => {
    const twoPages = () =>
      fetchGamesPage.mockImplementation(async (_season, { cursor } = {}) =>
        cursor === undefined
          ? { games: makeBdlGames(1, 100), nextCursor: 100 }
          : { games: makeBdlGames(101, 30), nextCursor: null },
      );

    it('1 ページ目を保存して cursor を進め、次のページのジョブを積む', async () => {
      twoPages();
      const { id } = await service.create(2015);

      await service.ingestPage({ ingestionId: id, cursor: null }, { isFinalAttempt: true });

      const ingestion = await prisma.ingestion.findUniqueOrThrow({ where: { id } });
      expect(ingestion).toMatchObject({ status: 'RUNNING', gamesFetched: 100, cursor: 100 });
      expect(ingestion.startedAt).toBeInstanceOf(Date);
      expect(queueAdd).toHaveBeenCalledWith(
        'ingest',
        { ingestionId: id, cursor: 100 },
        expect.objectContaining({ jobId: ingestionJobId(2015, 100) }),
      );
    });

    it('最後のページを保存したら COMPLETED にし、次のジョブは積まない', async () => {
      twoPages();
      const { id } = await service.create(2015);
      await service.ingestPage({ ingestionId: id, cursor: null }, { isFinalAttempt: true });
      queueAdd.mockClear();

      await service.ingestPage({ ingestionId: id, cursor: 100 }, { isFinalAttempt: true });

      const ingestion = await prisma.ingestion.findUniqueOrThrow({ where: { id } });
      expect(ingestion).toMatchObject({ status: 'COMPLETED', gamesFetched: 130, cursor: null });
      expect(ingestion.finishedAt).toBeInstanceOf(Date);
      expect(queueAdd).not.toHaveBeenCalled();
    });

    it('保存済みのページのジョブがもう一度来たら、API も保存もせず、次のジョブを積み直すだけにする', async () => {
      twoPages();
      const { id } = await service.create(2015);
      await service.ingestPage({ ingestionId: id, cursor: null }, { isFinalAttempt: true });

      await service.ingestPage({ ingestionId: id, cursor: null }, { isFinalAttempt: true });

      expect(fetchGamesPage).toHaveBeenCalledTimes(1);
      expect(await prisma.ingestion.findUniqueOrThrow({ where: { id } })).toMatchObject({
        gamesFetched: 100,
      });
      // 積み直しても jobId が同じなので、BullMQ が 1 つにまとめる
      expect(queueAdd.mock.calls.map(([, , opts]) => opts.jobId)).toEqual([
        ingestionJobId(2015, 100),
        ingestionJobId(2015, 100),
      ]);
    });

    it('同じページのジョブが 2 つ同時に動いても、件数を二重に数えない', async () => {
      twoPages();
      const { id } = await service.create(2015);

      // 両方が DB を読んで「未保存」と判断してから、保存に進む
      await Promise.all([
        service.ingestPage({ ingestionId: id, cursor: null }, { isFinalAttempt: true }),
        service.ingestPage({ ingestionId: id, cursor: null }, { isFinalAttempt: true }),
      ]);

      expect(fetchGamesPage).toHaveBeenCalledTimes(2);
      expect(await prisma.ingestion.findUniqueOrThrow({ where: { id } })).toMatchObject({
        gamesFetched: 100,
        cursor: 100,
      });
    });

    it('途中のページが最終試行で失敗したら FAILED にし、次のジョブは積まない', async () => {
      fetchGamesPage.mockRejectedValue(
        new BalldontlieApiError('HTTP Error: 429', {
          url: 'https://api.balldontlie.io/v1/games',
          status: 429,
          data: 'Too Many Requests',
        }),
      );
      const { id } = await service.create(2015);

      await expect(
        service.ingestPage({ ingestionId: id, cursor: null }, { isFinalAttempt: true }),
      ).rejects.toBeInstanceOf(BalldontlieApiError);

      expect(await prisma.ingestion.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'FAILED',
      });
      expect(queueAdd).not.toHaveBeenCalled();
    });
  });
});
