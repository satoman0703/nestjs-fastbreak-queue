import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import type { Queue } from 'bullmq';
import { AppModule } from '@/app.module.js';
import { ExportProcessor } from '@/export/export.processor.js';
import { EXPORT_BATCH_SIZE, EXPORT_QUEUE, type ExportJobData } from '@/export/export.queue.js';
import { ExportService } from '@/export/export.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import {
  EXPORT_CSV_2015_ROWS,
  EXPORT_CSV_2016_ROWS,
  EXPORT_CSV_HEADER,
  seedExportGames,
} from '../../test/fixtures/export-games.js';
import { truncateAll } from '../../test/setup-db.js';

/**
 * worker は別の非同期ループで動くので、終わるまで繰り返し確かめる（ingestion.processor.spec.ts と同じ理由で 2 秒）
 */
const WAIT_OPTIONS = { timeout: 2_000 };

describe('ExportProcessor', () => {
  let moduleRef: TestingModule;
  let service: ExportService;
  let prisma: PrismaService;
  let queue: Queue<ExportJobData>;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      imports: [AppModule.register('worker')],
    })
      // 4 試合が 2 つの Batch に分かれるようにする
      .overrideProvider(EXPORT_BATCH_SIZE)
      .useValue(2)
      .compile();
    await moduleRef.init();
    service = moduleRef.get(ExportService);
    prisma = moduleRef.get(PrismaService);
    queue = moduleRef.get(getQueueToken(EXPORT_QUEUE));
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await queue.obliterate({ force: true });
    await seedExportGames(prisma);
  });

  afterAll(async () => {
    await queue.obliterate({ force: true });
    await moduleRef.close();
  });

  it('execute → batch × 2 → complete まで進み、2 シーズン分の試合が日付順に並んだ CSV ができる', async () => {
    const { id } = await service.enqueue([2016, 2015]);

    await vi.waitFor(async () => {
      expect(await prisma.export.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'COMPLETED',
        batchCount: 2,
        batchesCompleted: 2,
        csv: EXPORT_CSV_HEADER + EXPORT_CSV_2015_ROWS + EXPORT_CSV_2016_ROWS,
      });
    }, WAIT_OPTIONS);
  });

  it('ジョブを同時に 3 つまで処理する', () => {
    expect(moduleRef.get(ExportProcessor).worker.opts.concurrency).toBe(3);
  });
});
