import type { PrismaClient } from '../src/generated/prisma/client.js';

/** テスト間でデータが残らないよう、全テーブルを空にする */
export async function truncateAll(prisma: PrismaClient): Promise<void> {
  await prisma.$executeRaw`
    TRUNCATE TABLE "Game", "Team", "Ingestion" RESTART IDENTITY CASCADE`;
}
