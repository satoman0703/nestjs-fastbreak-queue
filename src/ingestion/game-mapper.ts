import type { BdlGame, BdlTeam } from '../balldontlie/balldontlie.types.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * API のチームを Team テーブルの列に詰め替える
 */
export function toTeamData(team: BdlTeam): Prisma.TeamCreateInput {
  return {
    id: team.id,
    abbreviation: team.abbreviation,
    fullName: team.full_name,
    conference: team.conference,
    division: team.division,
  };
}

/**
 * API の試合を Game テーブルの列に詰め替える。
 * チームは入れ子のオブジェクトで返ってくるが、Team テーブルに別で保存するので id だけを持たせる
 */
export function toGameData(game: BdlGame): Prisma.GameUncheckedCreateInput {
  return {
    id: game.id,
    season: game.season,
    date: new Date(game.date),
    postseason: game.postseason,
    status: game.status,
    homeTeamId: game.home_team.id,
    visitorTeamId: game.visitor_team.id,
    homeScore: game.home_team_score,
    visitorScore: game.visitor_team_score,
    homeQ1: game.home_q1,
    homeQ2: game.home_q2,
    homeQ3: game.home_q3,
    homeQ4: game.home_q4,
    homeOt1: game.home_ot1,
    homeOt2: game.home_ot2,
    homeOt3: game.home_ot3,
    visitorQ1: game.visitor_q1,
    visitorQ2: game.visitor_q2,
    visitorQ3: game.visitor_q3,
    visitorQ4: game.visitor_q4,
    visitorOt1: game.visitor_ot1,
    visitorOt2: game.visitor_ot2,
    visitorOt3: game.visitor_ot3,
  };
}
