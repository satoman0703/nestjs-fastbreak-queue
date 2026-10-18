-- CreateEnum
CREATE TYPE "IngestionStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateTable
CREATE TABLE "Team" (
    "id" INTEGER NOT NULL,
    "abbreviation" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "conference" TEXT NOT NULL,
    "division" TEXT NOT NULL,

    CONSTRAINT "Team_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Game" (
    "id" INTEGER NOT NULL,
    "season" INTEGER NOT NULL,
    "date" DATE NOT NULL,
    "postseason" BOOLEAN NOT NULL,
    "status" TEXT NOT NULL,
    "homeTeamId" INTEGER NOT NULL,
    "visitorTeamId" INTEGER NOT NULL,
    "homeScore" INTEGER NOT NULL,
    "visitorScore" INTEGER NOT NULL,
    "homeQ1" INTEGER,
    "homeQ2" INTEGER,
    "homeQ3" INTEGER,
    "homeQ4" INTEGER,
    "homeOt1" INTEGER,
    "homeOt2" INTEGER,
    "homeOt3" INTEGER,
    "visitorQ1" INTEGER,
    "visitorQ2" INTEGER,
    "visitorQ3" INTEGER,
    "visitorQ4" INTEGER,
    "visitorOt1" INTEGER,
    "visitorOt2" INTEGER,
    "visitorOt3" INTEGER,

    CONSTRAINT "Game_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ingestion" (
    "id" TEXT NOT NULL,
    "season" INTEGER NOT NULL,
    "status" "IngestionStatus" NOT NULL DEFAULT 'PENDING',
    "gamesFetched" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Ingestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Game_season_idx" ON "Game"("season");

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_homeTeamId_fkey" FOREIGN KEY ("homeTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Game" ADD CONSTRAINT "Game_visitorTeamId_fkey" FOREIGN KEY ("visitorTeamId") REFERENCES "Team"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
