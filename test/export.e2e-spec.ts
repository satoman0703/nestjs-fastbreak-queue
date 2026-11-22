import { randomUUID } from 'node:crypto';
import { getQueueToken } from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import type { Queue } from 'bullmq';
import request from 'supertest';
import { App } from 'supertest/types.js';
import { AppModule } from '@/app.module.js';
import { setupApp } from '@/app.setup.js';
import { EXPORT_QUEUE, type ExportJobData, exportExecuteJobId } from '@/export/export.queue.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { truncateAll } from './setup-db.js';

describe('/api/exports (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;
  let queue: Queue<ExportJobData>;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule.register('api')],
    }).compile();
    app = moduleRef.createNestApplication();
    setupApp(app);
    await app.init();
    prisma = app.get(PrismaService);
    queue = app.get(getQueueToken(EXPORT_QUEUE));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await app.close();
  });

  describe('POST /api/exports', () => {
    it('エクスポートを待たずに 202 で返し、PENDING の行と execute のジョブを 1 つずつ作る', async () => {
      const res = await request(app.getHttpServer())
        .post('/api/exports')
        .send({ seasons: [2016, 2015] })
        .expect(202);

      const exports = await prisma.export.findMany();
      expect(exports).toHaveLength(1);
      const [exp] = exports;
      expect(res.body).toEqual({ id: exp.id, status: 'PENDING' });
      const jobs = await queue.getWaiting();
      expect(jobs.map(({ name, id, data }) => ({ name, id, data }))).toEqual([
        { name: 'execute', id: exportExecuteJobId(exp.id), data: { exportId: exp.id } },
      ]);
    });

    it('execute のジョブには attempts を付けない（リトライしないことは processor のテストで確かめる）', async () => {
      await request(app.getHttpServer())
        .post('/api/exports')
        .send({ seasons: [2015] });

      const [job] = await queue.getWaiting();
      // 指定しないと BullMQ が 0 を入れる。0 でも 1 回は実行し、失敗しても再実行しない
      expect(job.opts.attempts).toBe(0);
    });

    it.each([
      ['空', []],
      ['範囲外', [1983]],
      ['整数でない', [2015.5]],
      ['配列でない', 2015],
    ])('seasons が%sなら 400', async (_, seasons) => {
      await request(app.getHttpServer()).post('/api/exports').send({ seasons }).expect(400);
    });
  });

  describe('GET /api/exports/:id', () => {
    it('進み具合を返し、CSV の中身は返さない', async () => {
      const { id } = await prisma.export.create({ data: { seasons: [2015] } });

      const res = await request(app.getHttpServer()).get(`/api/exports/${id}`).expect(200);

      expect(res.body).toMatchObject({
        id,
        seasons: [2015],
        status: 'PENDING',
        batchCount: null,
        batchesCompleted: 0,
      });
      expect(res.body).not.toHaveProperty('csv');
    });

    it('無い id なら 404', async () => {
      await request(app.getHttpServer()).get(`/api/exports/${randomUUID()}`).expect(404);
    });

    it('uuid の形でなければ 400', async () => {
      await request(app.getHttpServer()).get('/api/exports/abc').expect(400);
    });
  });

  describe('GET /api/exports/:id/csv', () => {
    it('COMPLETED なら CSV を返す', async () => {
      const { id } = await prisma.export.create({
        data: { seasons: [2015], status: 'COMPLETED', csv: 'header\na\n' },
      });

      const res = await request(app.getHttpServer()).get(`/api/exports/${id}/csv`).expect(200);

      expect(res.headers['content-type']).toMatch(/^text\/csv/);
      expect(res.text).toBe('header\na\n');
    });

    it('まだ終わっていなければ 409', async () => {
      const { id } = await prisma.export.create({
        data: { seasons: [2015], status: 'FINALIZING' },
      });

      await request(app.getHttpServer()).get(`/api/exports/${id}/csv`).expect(409);
    });

    it('無い id なら 404', async () => {
      await request(app.getHttpServer()).get(`/api/exports/${randomUUID()}/csv`).expect(404);
    });
  });
});
