import type { PrismaClient } from '@/generated/prisma/client.js';

const HEADER = 'game_id,season,date,season_type,home_team,visitor_team,home_score,visitor_score\n';

/**
 * 指定した試合を 1 試合 1 行の CSV にする。Complete が Batch の CSV をそのまま連結するので、ヘッダは 1 つ目の Batch だけに付ける。
 * チーム略称にカンマや引用符は入らないので、エスケープしない
 */
export async function buildGamesCsv(
  prisma: Pick<PrismaClient, 'game'>,
  gameIds: number[],
  { withHeader }: { withHeader: boolean },
): Promise<string> {
  const games = await prisma.game.findMany({
    where: { id: { in: gameIds } },
    include: {
      homeTeam: { select: { abbreviation: true } },
      visitorTeam: { select: { abbreviation: true } },
    },
    orderBy: [{ date: 'asc' }, { id: 'asc' }],
  });
  const lines = games.map((g) =>
    [
      g.id,
      g.season,
      g.date.toISOString().slice(0, 10),
      g.postseason ? 'postseason' : 'regular',
      g.homeTeam.abbreviation,
      g.visitorTeam.abbreviation,
      g.homeScore,
      g.visitorScore,
    ].join(','),
  );
  return (withHeader ? HEADER : '') + lines.map((line) => `${line}\n`).join('');
}
