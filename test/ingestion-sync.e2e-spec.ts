import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { setupApp } from '@/app.setup.js';
import { BalldontlieApiClient } from '@/balldontlie/balldontlie-api-client.service.js';
import { SLEEP } from '@/common/sleep.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { makeBdlGames } from './fixtures/bdl-game.js';
import { truncateAll } from './setup-db.js';

describe('POST /ingestions/sync (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  const fetchGamesPage = vi.fn<BalldontlieApiClient['fetchGamesPage']>();

  beforeAll(async () => {
    process.env.APP_TYPE = 'api';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(BalldontlieApiClient)
      .useValue({ fetchGamesPage })
      .overrideProvider(SLEEP)
      .useValue(async () => {})
      .compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    fetchGamesPage
      .mockReset()
      .mockImplementation(async (_season, { cursor } = {}) =>
        cursor === undefined
          ? { games: makeBdlGames(1, 100), nextCursor: 100 }
          : { games: makeBdlGames(101, 30), nextCursor: null },
      );
  });

  afterAll(async () => {
    await app.close();
    delete process.env.APP_TYPE;
  });

  it('取り込みが終わるまで待ってから、結果を返す', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/ingestions/sync')
      .send({ season: 2015 })
      .expect(200);

    expect(res.body).toMatchObject({ status: 'COMPLETED', gamesFetched: 130 });
    expect(await prisma.game.count()).toBe(130);
  });

  it.each([
    ['文字列', 'abc'],
    ['小数', 2015.5],
    ['ジョーダンのルーキーシーズンより前', 1983],
    ['まだ終わっていないシーズン', 2026],
  ])('season が%sなら 400 を返し、取り込みを始めない', async (_label, season) => {
    await request(app.getHttpServer()).post('/api/ingestions/sync').send({ season }).expect(400);

    expect(await prisma.ingestion.count()).toBe(0);
    expect(fetchGamesPage).not.toHaveBeenCalled();
  });
});
