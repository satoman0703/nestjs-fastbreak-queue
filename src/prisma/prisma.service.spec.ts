import { PrismaService } from '@/prisma/prisma.service.js';
import { truncateAll } from '../../test/setup-db.js';

describe('PrismaService', () => {
  const prisma = new PrismaService();

  beforeAll(async () => {
    await prisma.onModuleInit();
  });

  beforeEach(async () => {
    await truncateAll(prisma);
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('Ingestion は PENDING・取得件数 0 で作られる', async () => {
    const ingestion = await prisma.ingestion.create({ data: { season: 2015 } });

    expect(ingestion.status).toBe('PENDING');
    expect(ingestion.gamesFetched).toBe(0);
  });
});
