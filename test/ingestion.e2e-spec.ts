import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { setupApp } from '@/app.setup.js';
import {
  INGESTION_QUEUE,
  type IngestionJobData,
  ingestionJobId,
} from '@/ingestion/ingestion.queue.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { truncateAll } from './setup-db.js';

describe('/api/ingestions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let queue: Queue<IngestionJobData>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register('api')],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    queue = app.get(getQueueToken(INGESTION_QUEUE));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await queue.obliterate({ force: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  describe('POST /api/ingestions', () => {
    it('取り込みを待たずに 202 で返し、PENDING の行とジョブを 1 つずつ作る', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/ingestions')
        .send({ season: 2015 })
        .expect(202);

      const ingestions = await prisma.ingestion.findMany();
      expect(ingestions).toHaveLength(1);
      const [ingestion] = ingestions;
      expect(ingestion).toMatchObject({ season: 2015, status: 'PENDING' });
      expect(res.body).toEqual({ id: ingestion.id, status: 'PENDING' });
      const jobs = await queue.getWaiting();
      expect(jobs.map((job) => job.data)).toEqual([{ ingestionId: ingestion.id, cursor: null }]);
    });

    it('同じシーズンを 2 回積んでも、待ち行列のジョブは 1 つ', async () => {
      await request(app.getHttpServer()).post('/api/ingestions').send({ season: 2015 });
      await request(app.getHttpServer()).post('/api/ingestions').send({ season: 2015 });

      expect(await queue.getWaitingCount()).toBe(1);
    });

    it('積んだジョブには、リトライの回数と待ち方が付いている', async () => {
      await request(app.getHttpServer()).post('/api/ingestions').send({ season: 2015 }).expect(202);

      const [job] = await queue.getWaiting();
      expect(job.opts).toMatchObject({
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
      });
    });

    it('同じシーズンが待ち・実行中なら 409 を返し、2 つ目の行を作らない', async () => {
      await request(app.getHttpServer()).post('/api/ingestions').send({ season: 2015 }).expect(202);
      await request(app.getHttpServer()).post('/api/ingestions').send({ season: 2015 }).expect(409);

      expect(await prisma.ingestion.count()).toBe(1);
    });

    it('同じシーズンのチェーンが 2 ページ目以降の途中でも 409 を返す', async () => {
      await queue.add(
        'ingest',
        { ingestionId: 'in-progress', cursor: 100 },
        { jobId: ingestionJobId(2015, 100) },
      );

      await request(app.getHttpServer()).post('/api/ingestions').send({ season: 2015 }).expect(409);
    });

    it('season が不正なら 400 を返し、行もジョブも作らない', async () => {
      await request(app.getHttpServer())
        .post('/api/ingestions')
        .send({ season: 'abc' })
        .expect(400);

      expect(await prisma.ingestion.count()).toBe(0);
      expect(await queue.getWaitingCount()).toBe(0);
    });

    it('キューに積めなければ 500 を返し、行を FAILED にする', async () => {
      vi.spyOn(queue, 'add').mockRejectedValue(new Error('Redis is down'));

      await request(app.getHttpServer()).post('/api/ingestions').send({ season: 2015 }).expect(500);

      const [ingestion] = await prisma.ingestion.findMany();
      expect(ingestion).toMatchObject({ status: 'FAILED', error: 'Redis is down' });
    });
  });

  describe('GET /api/ingestions/:id', () => {
    it('取り込みの状態を返す', async () => {
      const ingestion = await prisma.ingestion.create({
        data: {
          season: 2015,
          status: 'COMPLETED',
          gamesFetched: 1316,
          startedAt: new Date('2026-10-21T00:00:00Z'),
          finishedAt: new Date('2026-10-21T00:03:00Z'),
        },
      });

      const res = await request(app.getHttpServer())
        .get(`/api/ingestions/${ingestion.id}`)
        .expect(200);

      expect(res.body).toEqual({
        id: ingestion.id,
        season: 2015,
        status: 'COMPLETED',
        gamesFetched: 1316,
        error: null,
        startedAt: '2026-10-21T00:00:00.000Z',
        finishedAt: '2026-10-21T00:03:00.000Z',
        createdAt: ingestion.createdAt.toISOString(),
      });
    });

    it('存在しない id なら 404 を返す', async () => {
      await request(app.getHttpServer()).get(`/api/ingestions/${randomUUID()}`).expect(404);
    });

    it('id が uuid の形でなければ 400 を返す', async () => {
      await request(app.getHttpServer()).get('/api/ingestions/abc').expect(400);
    });
  });
});
