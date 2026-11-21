import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import { EXPORT_QUEUE, exportBatchJobId } from '@/export/export.queue.js';
import { ExportService } from '@/export/export.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import { truncateAll } from '../../test/setup-db.js';

describe('ExportService', () => {
  const queueAdd = vi.fn();
  const queueAddBulk = vi.fn();
  let moduleRef: TestingModule;
  let service: ExportService;
  let prisma: PrismaService;

  beforeAll(async () => {
    moduleRef = await Test.createTestingModule({
      providers: [
        ExportService,
        PrismaService,
        // どのジョブを積んだかだけを見る
        {
          provide: getQueueToken(EXPORT_QUEUE),
          useValue: { add: queueAdd, addBulk: queueAddBulk },
        },
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(ExportService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    queueAdd.mockReset();
    queueAddBulk.mockReset();
  });

  afterAll(async () => {
    await moduleRef.close();
  });

  it('enqueue はシーズンの重複を除いて昇順にし、PENDING で作る', async () => {
    const { id } = await service.enqueue([2016, 2015, 2016]);

    expect(await prisma.export.findUniqueOrThrow({ where: { id } })).toMatchObject({
      seasons: [2015, 2016],
      status: 'PENDING',
      batchCount: null,
    });
  });

  describe('execute', () => {
    it('1 シーズン = 1 Batch に分け、batchCount を記録して PROCESSING にする', async () => {
      const { id } = await service.enqueue([2016, 2015]);

      await service.execute(id);

      expect(await prisma.export.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'PROCESSING',
        batchCount: 2,
        batchesCompleted: 0,
      });
    });

    it('Batch のジョブを batchNumber 1 から順に、まとめて積む', async () => {
      const { id } = await service.enqueue([2016, 2015]);

      await service.execute(id);

      expect(queueAddBulk).toHaveBeenCalledTimes(1);
      const [jobs] = queueAddBulk.mock.calls[0];
      expect(
        jobs.map(
          ({ name, data, opts }: { name: string; data: unknown; opts: { jobId: string } }) => ({
            name,
            data,
            jobId: opts.jobId,
          }),
        ),
      ).toEqual([
        { name: 'batch', data: { exportId: id, batchNumber: 1 }, jobId: exportBatchJobId(id, 1) },
        { name: 'batch', data: { exportId: id, batchNumber: 2 }, jobId: exportBatchJobId(id, 2) },
      ]);
    });
  });
});
