import { z } from 'zod';

/**
 * GET /v1/games のレスポンスのうち、このアプリで使う項目だけ。
 * 型だけだと実行時は素通りし、項目名が変わると nullable の列が黙って null で保存されるため、
 * 受け取った時点で形を検証する。
 */
const quarter = z.number().nullable();

export const bdlTeamSchema = z.object({
  id: z.number(),
  abbreviation: z.string(),
  full_name: z.string(),
  conference: z.string(),
  division: z.string(),
});

export const bdlGameSchema = z.object({
  id: z.number(),
  date: z.string(),
  season: z.number(),
  status: z.string(),
  postseason: z.boolean(),
  home_team_score: z.number(),
  visitor_team_score: z.number(),
  home_q1: quarter,
  home_q2: quarter,
  home_q3: quarter,
  home_q4: quarter,
  home_ot1: quarter,
  home_ot2: quarter,
  home_ot3: quarter,
  visitor_q1: quarter,
  visitor_q2: quarter,
  visitor_q3: quarter,
  visitor_q4: quarter,
  visitor_ot1: quarter,
  visitor_ot2: quarter,
  visitor_ot3: quarter,
  home_team: bdlTeamSchema,
  visitor_team: bdlTeamSchema,
});

export const bdlGamesResponseSchema = z.object({
  data: z.array(bdlGameSchema),
  meta: z.object({ next_cursor: z.number().optional(), per_page: z.number() }),
});

export type BdlTeam = z.infer<typeof bdlTeamSchema>;
export type BdlGame = z.infer<typeof bdlGameSchema>;
