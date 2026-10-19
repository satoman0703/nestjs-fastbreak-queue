import type { BdlGame } from '@/balldontlie/balldontlie.types.js';

const hawks = {
  id: 1,
  abbreviation: 'ATL',
  full_name: 'Atlanta Hawks',
  conference: 'East',
  division: 'Southeast',
};

const pistons = {
  id: 9,
  abbreviation: 'DET',
  full_name: 'Detroit Pistons',
  conference: 'East',
  division: 'Central',
};

/**
 * 実際の API レスポンス（2015-10-27 ATL vs DET）を元にしたテスト用の試合。
 * 試合 id だけを変えて、複数ページ分のデータを作れるようにする
 */
export function makeBdlGame(id = 27682): BdlGame {
  return {
    id,
    date: '2015-10-27',
    season: 2015,
    status: 'Final',
    postseason: false,
    home_team_score: 94,
    visitor_team_score: 106,
    home_q1: 25,
    home_q2: 18,
    home_q3: 23,
    home_q4: 28,
    home_ot1: null,
    home_ot2: null,
    home_ot3: null,
    visitor_q1: 25,
    visitor_q2: 23,
    visitor_q3: 34,
    visitor_q4: 24,
    visitor_ot1: null,
    visitor_ot2: null,
    visitor_ot3: null,
    home_team: hawks,
    visitor_team: pistons,
  };
}

/** id が start から連番の試合を count 件作る */
export function makeBdlGames(start: number, count: number): BdlGame[] {
  return Array.from({ length: count }, (_, i) => makeBdlGame(start + i));
}
