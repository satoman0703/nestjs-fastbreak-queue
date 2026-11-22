import type { PrismaClient } from '@/generated/prisma/client.js';

/**
 * エクスポートを確かめるための 2 チーム・4 試合。2015 に 3 試合（うち 1 試合はプレーオフ）、2016 に 1 試合
 */
export async function seedExportGames(prisma: PrismaClient): Promise<void> {
  await prisma.team.createMany({
    data: [
      { id: 1, abbreviation: 'AAA', fullName: 'Team A', conference: 'East', division: 'Atlantic' },
      { id: 2, abbreviation: 'BBB', fullName: 'Team B', conference: 'West', division: 'Pacific' },
    ],
  });
  const game = (
    id: number,
    season: number,
    date: string,
    postseason: boolean,
    [homeTeamId, homeScore]: [number, number],
    [visitorTeamId, visitorScore]: [number, number],
  ) => ({
    id,
    season,
    date: new Date(date),
    postseason,
    status: 'Final',
    homeTeamId,
    homeScore,
    visitorTeamId,
    visitorScore,
  });
  await prisma.game.createMany({
    data: [
      // id と日付の順を逆にして、CSV が日付順に並ぶことを確かめる。2015 シーズンのプレーオフは 2016 年 4 月
      game(2, 2015, '2015-11-01', false, [1, 100], [2, 90]),
      game(1, 2015, '2015-11-02', false, [2, 110], [1, 95]),
      game(3, 2015, '2016-04-20', true, [1, 95], [2, 90]),
      game(4, 2016, '2016-11-01', false, [2, 80], [1, 70]),
    ],
  });
}

export const EXPORT_CSV_HEADER =
  'game_id,season,date,season_type,home_team,visitor_team,home_score,visitor_score\n';

/** seedExportGames の 2015 シーズンの 3 試合を、日付順に並べた行 */
export const EXPORT_CSV_2015_ROWS =
  '2,2015,2015-11-01,regular,AAA,BBB,100,90\n' +
  '1,2015,2015-11-02,regular,BBB,AAA,110,95\n' +
  '3,2015,2016-04-20,postseason,AAA,BBB,95,90\n';

export const EXPORT_CSV_2016_ROWS = '4,2016,2016-11-01,regular,BBB,AAA,80,70\n';
