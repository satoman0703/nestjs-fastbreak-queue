import { z } from 'zod';

/**
 * 取り込める最初のシーズン（ジョーダンのルーキーシーズン）。
 * 1950 年代以前は API のスコアが 0 のことがあり、クォーター別のスコアも確認できている 1984 以降に絞る
 */
export const MIN_SEASON = 1984;

/**
 * 取り込める最後のシーズン（終わっているシーズン）。
 * 進行中のシーズンは試合前の status が開始時刻になり、スコアも 0 のため含めない。毎年 6 月のシーズン終了後に 1 つ進める
 */
export const MAX_SEASON = 2025;

export const createIngestionSchema = z.object({
  season: z.number().int().min(MIN_SEASON).max(MAX_SEASON),
});

export type CreateIngestionDto = z.infer<typeof createIngestionSchema>;
