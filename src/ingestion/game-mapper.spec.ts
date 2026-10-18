import type { BdlGame } from '../balldontlie/balldontlie.types.js';
import { toGameData, toTeamData } from './game-mapper.js';

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

/** 実際の API レスポンス（2015-10-27 ATL vs DET） */
const game: BdlGame = {
  id: 27682,
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

describe('toTeamData', () => {
  it('API のチームを Team の列に詰め替える', () => {
    expect(toTeamData(hawks)).toEqual({
      id: 1,
      abbreviation: 'ATL',
      fullName: 'Atlanta Hawks',
      conference: 'East',
      division: 'Southeast',
    });
  });
});

describe('toGameData', () => {
  it('API の試合を Game の列に詰め替え、チームは id だけにする', () => {
    expect(toGameData(game)).toEqual({
      id: 27682,
      season: 2015,
      date: new Date('2015-10-27'),
      postseason: false,
      status: 'Final',
      homeTeamId: 1,
      visitorTeamId: 9,
      homeScore: 94,
      visitorScore: 106,
      homeQ1: 25,
      homeQ2: 18,
      homeQ3: 23,
      homeQ4: 28,
      homeOt1: null,
      homeOt2: null,
      homeOt3: null,
      visitorQ1: 25,
      visitorQ2: 23,
      visitorQ3: 34,
      visitorQ4: 24,
      visitorOt1: null,
      visitorOt2: null,
      visitorOt3: null,
    });
  });
});
