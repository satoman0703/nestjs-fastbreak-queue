import type { JobsOptions } from 'bullmq';

/**
 * 取り込みジョブのキュー名。投入する側（api）と処理する側（worker）で同じ名前を使う必要があるため、定数にする
 */
export const INGESTION_QUEUE = 'ingestion';

/**
 * ジョブに載せるのは id と、そのジョブが取るページの cursor（null は 1 ページ目）だけ。
 * シーズンなどの中身は DB の Ingestion から読み、Redis と DB で値が食い違わないようにする
 */
export type IngestionJobData = { ingestionId: string; cursor: number | null };

/**
 * balldontlie 無料プランの 5 回/分を、worker が何台あってもキュー全体で守る。
 * BullMQ の limiter は API 呼び出しではなくジョブを数えるので、1 ジョブ = 1 ページ（API 1 回）にしている
 */
export const INGESTION_RATE_LIMIT = { max: 5, duration: 60_000 } as const;

/**
 * 429 は 1 分待てば回復する見込みなので、30 秒 → 60 秒と間隔を倍にして、最初の失敗を含め 3 回まで試す
 */
export const INGESTION_JOB_RETRY = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
} as const satisfies Pick<JobsOptions, 'attempts' | 'backoff'>;

/**
 * 同じシーズン・同じページのジョブを 1 つにまとめるための jobId。
 * ingestionId は POST のたびに変わるので使えない。BullMQ の custom jobId は `:` を含められないため `-` でつなぐ
 */
export function ingestionJobId(season: number, cursor: number | null): string {
  return `${ingestionJobIdPrefix(season)}cursor-${cursor ?? 'first'}`;
}

/**
 * チェーンのどのページにいても、そのシーズンのジョブを見つけるための jobId の先頭部分
 */
export function ingestionJobIdPrefix(season: number): string {
  return `ingestion-season-${season}-`;
}
