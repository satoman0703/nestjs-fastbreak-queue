import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { setupApp } from '@/app.setup.js';
import { INGESTION_QUEUE, type IngestionJobData } from '@/ingestion/ingestion.queue.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { truncateAll } from './setup-db.js';

describe('POST /api/ingestions (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let queue: Queue<IngestionJobData>;

  beforeAll(async () => {
    vi.stubEnv('APP_TYPE', 'api');
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    vi.unstubAllEnvs();
  });

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
    expect(jobs.map((job) => job.data)).toEqual([{ ingestionId: ingestion.id }]);
  });

  it('season が不正なら 400 を返し、行もジョブも作らない', async () => {
    await request(app.getHttpServer()).post('/api/ingestions').send({ season: 'abc' }).expect(400);

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
