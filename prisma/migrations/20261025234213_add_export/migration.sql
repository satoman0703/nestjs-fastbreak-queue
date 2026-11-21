-- CreateEnum
CREATE TYPE "ExportStatus" AS ENUM ('PENDING', 'PROCESSING', 'FINALIZING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Export" (
    "id" TEXT NOT NULL,
    "seasons" INTEGER[],
    "status" "ExportStatus" NOT NULL DEFAULT 'PENDING',
    "batchCount" INTEGER,
    "batchesCompleted" INTEGER NOT NULL DEFAULT 0,
    "csv" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Export_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportPart" (
    "exportId" TEXT NOT NULL,
    "batchNumber" INTEGER NOT NULL,
    "csv" TEXT NOT NULL,

    CONSTRAINT "ExportPart_pkey" PRIMARY KEY ("exportId","batchNumber")
);

-- AddForeignKey
ALTER TABLE "ExportPart" ADD CONSTRAINT "ExportPart_exportId_fkey" FOREIGN KEY ("exportId") REFERENCES "Export"("id") ON DELETE CASCADE ON UPDATE CASCADE;
