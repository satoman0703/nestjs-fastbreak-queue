import { getQueueToken } from '@nestjs/bullmq';
import { Test, type TestingModule } from '@nestjs/testing';
import {
  EXPORT_BATCH_SIZE,
  EXPORT_QUEUE,
  exportBatchJobId,
  exportCompleteJobId,
} from '@/export/export.queue.js';
import { ExportService } from '@/export/export.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';
import {
  EXPORT_CSV_2015_ROWS,
  EXPORT_CSV_2016_ROWS,
  EXPORT_CSV_HEADER,
  seedExportGames,
} from '../../test/fixtures/export-games.js';
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
        // 4 試合でも複数の Batch に分かれるよう、2 試合ずつにする
        { provide: EXPORT_BATCH_SIZE, useValue: 2 },
      ],
    }).compile();
    await moduleRef.init();
    service = moduleRef.get(ExportService);
    prisma = moduleRef.get(PrismaService);
  });

  beforeEach(async () => {
    await truncateAll(prisma);
    await seedExportGames(prisma);
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
    const batchJobs = () =>
      queueAddBulk.mock.calls[0][0].map(
        ({ data, opts }: { data: unknown; opts: { jobId: string } }) => ({
          data,
          jobId: opts.jobId,
        }),
      );

    it('対象の試合を日付順に 2 試合ずつ分けて Batch を積み、batchCount を記録して PROCESSING にする', async () => {
      const { id } = await service.enqueue([2015, 2016]);

      await service.execute(id);

      expect(await prisma.export.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'PROCESSING',
        batchCount: 2,
        batchesCompleted: 0,
      });
      expect(queueAddBulk).toHaveBeenCalledTimes(1);
      expect(batchJobs()).toEqual([
        { data: { exportId: id, batchNumber: 1, gameIds: [2, 1] }, jobId: exportBatchJobId(id, 1) },
        { data: { exportId: id, batchNumber: 2, gameIds: [3, 4] }, jobId: exportBatchJobId(id, 2) },
      ]);
    });

    it('指定していないシーズンの試合は含めない', async () => {
      const { id } = await service.enqueue([2016]);

      await service.execute(id);

      expect(batchJobs()).toEqual([
        { data: { exportId: id, batchNumber: 1, gameIds: [4] }, jobId: exportBatchJobId(id, 1) },
      ]);
    });

    it('試合が無くても、ヘッダだけの CSV を作るために Batch を 1 つ積む', async () => {
      const { id } = await service.enqueue([2019]);

      await service.execute(id);

      expect(batchJobs()).toEqual([
        { data: { exportId: id, batchNumber: 1, gameIds: [] }, jobId: exportBatchJobId(id, 1) },
      ]);
    });
  });

  describe('runBatch', () => {
    /** execute まで済ませた（batchCount を書いた）Export を作る */
    const executed = async (seasons: number[]) => {
      const { id } = await service.enqueue(seasons);
      await service.execute(id);
      queueAdd.mockReset();
      return id;
    };
    const part = (exportId: string, batchNumber: number) =>
      prisma.exportPart.findUniqueOrThrow({
        where: { exportId_batchNumber: { exportId, batchNumber } },
      });
    const completeJobs = () => queueAdd.mock.calls.filter(([name]) => name === 'complete');

    it('1 つ目の Batch はヘッダ付きで渡された試合を 1 行ずつ保存し、終わった数を 1 にする', async () => {
      const id = await executed([2015, 2016]);

      await service.runBatch({ exportId: id, batchNumber: 1, gameIds: [2, 1] });

      expect(await part(id, 1)).toMatchObject({
        csv:
          EXPORT_CSV_HEADER +
          '2,2015,2015-11-01,regular,AAA,BBB,100,90\n' +
          '1,2015,2015-11-02,regular,BBB,AAA,110,95\n',
      });
      expect(await prisma.export.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'PROCESSING',
        batchesCompleted: 1,
      });
      expect(completeJobs()).toHaveLength(0);
    });

    it('2 つ目以降の Batch はヘッダを付けない', async () => {
      const id = await executed([2015, 2016]);

      await service.runBatch({ exportId: id, batchNumber: 2, gameIds: [4] });

      expect(await part(id, 2)).toMatchObject({ csv: EXPORT_CSV_2016_ROWS });
    });

    it('最後に終わった Batch が FINALIZING にして complete を積む', async () => {
      const id = await executed([2015, 2016]);

      await service.runBatch({ exportId: id, batchNumber: 2, gameIds: [3, 4] });
      await service.runBatch({ exportId: id, batchNumber: 1, gameIds: [2, 1] });

      expect(await prisma.export.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'FINALIZING',
        batchesCompleted: 2,
      });
      expect(completeJobs()).toEqual([
        ['complete', { exportId: id }, expect.objectContaining({ jobId: exportCompleteJobId(id) })],
      ]);
    });

    it('Batch が同時に終わっても、complete は 1 回だけ積む', async () => {
      const id = await executed([2015, 2016]);

      await Promise.all([
        service.runBatch({ exportId: id, batchNumber: 1, gameIds: [2, 1] }),
        service.runBatch({ exportId: id, batchNumber: 2, gameIds: [3, 4] }),
      ]);

      expect(completeJobs()).toHaveLength(1);
    });

    it('試合が無い Batch も、ヘッダだけ保存して終わった数に入れる', async () => {
      const id = await executed([2019]);

      await service.runBatch({ exportId: id, batchNumber: 1, gameIds: [] });

      expect(await part(id, 1)).toMatchObject({ csv: EXPORT_CSV_HEADER });
      expect(await prisma.export.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'FINALIZING',
      });
    });
  });

  describe('complete', () => {
    it('Batch の CSV を batchNumber の順に連結し、COMPLETED にして終了時刻を記録する', async () => {
      const { id } = await prisma.export.create({
        data: {
          seasons: [2015, 2016],
          status: 'FINALIZING',
          batchCount: 2,
          batchesCompleted: 2,
          // 番号と逆の順に保存しても、番号の順に並べる
          parts: {
            create: [
              { batchNumber: 2, csv: EXPORT_CSV_2016_ROWS },
              { batchNumber: 1, csv: EXPORT_CSV_HEADER + EXPORT_CSV_2015_ROWS },
            ],
          },
        },
      });

      await service.complete(id);

      const exp = await prisma.export.findUniqueOrThrow({ where: { id } });
      expect(exp).toMatchObject({
        status: 'COMPLETED',
        csv: EXPORT_CSV_HEADER + EXPORT_CSV_2015_ROWS + EXPORT_CSV_2016_ROWS,
      });
      expect(exp.finishedAt).toBeInstanceOf(Date);
    });

    it('FINALIZING でなければ何もしない', async () => {
      const { id } = await prisma.export.create({
        data: { seasons: [2015], status: 'FAILED', batchCount: 1, batchesCompleted: 1 },
      });

      await service.complete(id);

      expect(await prisma.export.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'FAILED',
        csv: null,
      });
    });
  });
});
