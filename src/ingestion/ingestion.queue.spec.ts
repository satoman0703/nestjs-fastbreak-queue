import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppModule } from '@/app.module.js';
import { INGESTION_QUEUE } from '@/ingestion/ingestion.queue.js';

describe('ingestion キュー', () => {
  let moduleRef: TestingModule;
  let queue: Queue;

  beforeAll(async () => {
    vi.stubEnv('APP_TYPE', 'api');
    moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    await moduleRef.init();
    queue = moduleRef.get<Queue>(getQueueToken(INGESTION_QUEUE));
  });

  beforeEach(async () => {
    // 前のテストで積んだジョブを消す
    await queue.obliterate({ force: true });
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await moduleRef.close();
    vi.unstubAllEnvs();
  });

  it('キュー名は ingestion', () => {
    expect(INGESTION_QUEUE).toBe('ingestion');
  });

  it('Redis に繋がっていて、積んだジョブが待ち行列に入る', async () => {
    await queue.add('hello', { message: 'world' });

    expect(await queue.getWaitingCount()).toBe(1);
  });

  it('テストでは開発用と混ざらないよう、Redis のキー名の頭が test になる', () => {
    expect(queue.opts.prefix).toBe('test');
  });
});
