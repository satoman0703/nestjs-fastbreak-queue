import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Job, Queue } from 'bullmq';
import { AppModule } from '@/app.module.js';
import {
  BalldontlieApiClient,
  BalldontlieApiError,
} from '@/balldontlie/balldontlie-api-client.service.js';
import { SLEEP } from '@/common/sleep.js';
import {
  INGESTION_QUEUE,
  type IngestionJobData,
  ingestionJobId,
} from '@/ingestion/ingestion.queue.js';
import { IngestionProcessor } from '@/ingestion/ingestion.processor.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { makeBdlGames } from '../../test/fixtures/bdl-game.js';
import { truncateAll } from '../../test/setup-db.js';

/**
 * worker は別の非同期ループで動くので、終わるまで繰り返し確かめる。
 * waitFor の既定（1 秒）だと遅いマシンで落ちうるため延ばす。何度も待つテストは、合計がテスト自体の上限（既定 5 秒）を超えうるので、テストの上限も延ばす
 */
const WAIT_OPTIONS = { timeout: 2_000 };

describe('IngestionProcessor', () => {
  const fetchGamesPage = vi.fn<BalldontlieApiClient['fetchGamesPage']>();
  let moduleRef: TestingModule;
  let service: IngestionService;
  let prisma: PrismaService;
  let queue: Queue<IngestionJobData>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({ imports: [AppModule.register('worker')] })
      .overrideProvider(BalldontlieApiClient)
      .useValue({ fetchGamesPage })
      .overrideProvider(SLEEP)
      .useValue(async () => {})
      .compile();
    await moduleRef.init();
    service = moduleRef.get(IngestionService);
    prisma = moduleRef.get(PrismaService);
    queue = moduleRef.get(getQueueToken(INGESTION_QUEUE));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await queue.obliterate({ force: true });
    // limiter が数えた回数は Redis に 60 秒残るので、前のテストで処理したジョブの分を消す
    await queue.removeRateLimitKey();
    fetchGamesPage.mockReset();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await queue.removeRateLimitKey();
    await moduleRef.close();
  });

  const completeTwoPages = () =>
    fetchGamesPage.mockImplementation(async (_season, { cursor } = {}) =>
      cursor === undefined
        ? { games: makeBdlGames(1, 100), nextCursor: 100 }
        : { games: makeBdlGames(101, 30), nextCursor: null },
    );

  const waitForStatus = async (id: string, status: 'COMPLETED' | 'FAILED') => {
    await vi.waitFor(async () => {
      expect(await prisma.ingestion.findUniqueOrThrow({ where: { id } })).toMatchObject({ status });
    }, WAIT_OPTIONS);
  };

  // DB を更新した後で process が返り、そこで BullMQ がジョブを消すため、DB とは別に待つ
  const waitForJobsRemoved = async () => {
    await vi.waitFor(async () => {
      expect(await queue.getJobCountByTypes('waiting', 'active', 'delayed', 'prioritized')).toBe(0);
    }, WAIT_OPTIONS);
  };

  it('1 ページずつジョブがつながり、最後のページで COMPLETED になり、ジョブは Redis から消える', async () => {
    completeTwoPages();

    const { id } = await service.enqueue(2015);

    await waitForStatus(id, 'COMPLETED');
    expect(await prisma.ingestion.findUniqueOrThrow({ where: { id } })).toMatchObject({
      gamesFetched: 130,
    });
    await waitForJobsRemoved();
  });

  it('1 回目で失敗したら、ジョブはリトライ待ちになり、DB の行は FAILED ではなく PENDING でエラーを残す', async () => {
    fetchGamesPage.mockRejectedValue(
      new BalldontlieApiError('HTTP Error: 429', {
        url: 'https://api.balldontlie.io/v1/games',
        status: 429,
        data: 'Too Many Requests',
      }),
    );

    const { id } = await service.enqueue(2015);

    await vi.waitFor(async () => {
      const job = await queue.getJob(ingestionJobId(2015, null));
      expect(await job?.getState()).toBe('delayed');
      expect(job?.attemptsMade).toBe(1);
    }, WAIT_OPTIONS);
    const ingestion = await prisma.ingestion.findUniqueOrThrow({ where: { id } });
    expect(ingestion).toMatchObject({ status: 'PENDING', error: 'HTTP Error: 429' });
    expect(ingestion.finishedAt).toBeNull();
  });

  it('前回の取り込みが終わった後なら、同じシーズンをもう一度積んで処理できる', async () => {
    completeTwoPages();
    const first = await service.enqueue(2015);
    await waitForStatus(first.id, 'COMPLETED');
    await waitForJobsRemoved();

    const second = await service.enqueue(2015);

    await waitForStatus(second.id, 'COMPLETED');
  }, 10_000);

  it('worker はキュー全体で 60 秒に 5 ジョブまでしか処理しない（1 ジョブ = API 1 回なので 5 回/分）', () => {
    const { worker } = moduleRef.get(IngestionProcessor);

    expect(worker.opts.limiter).toEqual({ max: 5, duration: 60_000 });
  });

  describe('最終試行かどうかの判定', () => {
    const ingestPage = vi.fn<IngestionService['ingestPage']>();
    const processor = new IngestionProcessor({ ingestPage } as unknown as IngestionService);
    const jobWith = (attemptsMade: number) =>
      ({
        data: { ingestionId: 'ingestion-1', cursor: null },
        attemptsMade,
        opts: { attempts: 3 },
      }) as unknown as Job<IngestionJobData>;

    beforeEach(() => {
      ingestPage.mockReset().mockResolvedValue(undefined);
    });

    it('3 回中 1 回目（まだ 1 回も失敗していない）は最終試行ではない', async () => {
      await processor.process(jobWith(0));

      expect(ingestPage).toHaveBeenCalledWith(
        { ingestionId: 'ingestion-1', cursor: null },
        { isFinalAttempt: false },
      );
    });

    it('3 回中 3 回目（2 回失敗した後）は最終試行', async () => {
      await processor.process(jobWith(2));

      expect(ingestPage).toHaveBeenCalledWith(
        { ingestionId: 'ingestion-1', cursor: null },
        { isFinalAttempt: true },
      );
    });
  });
});
