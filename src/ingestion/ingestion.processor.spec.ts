import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppModule } from '@/app.module.js';
import {
  BalldontlieApiClient,
  BalldontlieApiError,
} from '@/balldontlie/balldontlie-api-client.service.js';
import { SLEEP } from '@/common/sleep.js';
import { INGESTION_QUEUE, type IngestionJobData } from '@/ingestion/ingestion.queue.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { makeBdlGames } from '../../test/fixtures/bdl-game.js';
import { truncateAll } from '../../test/setup-db.js';

/**
 * worker は別の非同期ループで動くので、終わるまで繰り返し確かめる。
 * waitFor の既定（1 秒）だと遅いマシンで落ちうるため延ばす。1 テストで 2 回待つので、合計がテスト自体の上限（5 秒）に収まる値にする
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
    fetchGamesPage.mockReset();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await moduleRef.close();
  });

  it('積んだジョブを worker が取り出し、取り込みを COMPLETED まで進める', async () => {
    fetchGamesPage.mockImplementation(async (_season, { cursor } = {}) =>
      cursor === undefined
        ? { games: makeBdlGames(1, 100), nextCursor: 100 }
        : { games: makeBdlGames(101, 30), nextCursor: null },
    );

    const { id } = await service.enqueue(2015);

    await vi.waitFor(async () => {
      expect(await prisma.ingestion.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'COMPLETED',
        gamesFetched: 130,
      });
    }, WAIT_OPTIONS);
    // DB を COMPLETED にした後で process が返り、そこで BullMQ が completed に移すため、別に待つ
    await vi.waitFor(async () => {
      expect(await queue.getCompletedCount()).toBe(1);
    }, WAIT_OPTIONS);
  });

  it('取り込みが失敗したら、ジョブは failed に入り、DB の行は FAILED になる', async () => {
    fetchGamesPage.mockRejectedValue(
      new BalldontlieApiError('HTTP Error: 429', {
        url: 'https://api.balldontlie.io/v1/games',
        status: 429,
        data: 'Too Many Requests',
      }),
    );

    const { id } = await service.enqueue(2015);

    await vi.waitFor(async () => {
      expect(await queue.getFailedCount()).toBe(1);
    }, WAIT_OPTIONS);
    const ingestion = await prisma.ingestion.findUniqueOrThrow({ where: { id } });
    expect(ingestion).toMatchObject({ status: 'FAILED', error: 'HTTP Error: 429' });
    expect(ingestion.finishedAt).toBeInstanceOf(Date);
  });
});
