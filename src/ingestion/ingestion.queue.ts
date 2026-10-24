import type { JobsOptions } from 'bullmq';

/**
 * 取り込みジョブのキュー名。投入する側（api）と処理する側（worker）で同じ名前を使う必要があるため、定数にする
 */
export const INGESTION_QUEUE = 'ingestion';

/**
 * ジョブに載せるのは id だけ。シーズンなどの中身は DB の Ingestion から読み、Redis と DB で値が食い違わないようにする
 */
export type IngestionJobData = { ingestionId: string };

/**
 * 429 は 1 分待てば回復する見込みなので、30 秒 → 60 秒と間隔を倍にして、最初の失敗を含め 3 回まで試す
 */
export const INGESTION_JOB_RETRY = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 30_000 },
} as const satisfies Pick<JobsOptions, 'attempts' | 'backoff'>;

/**
 * 同じシーズンのジョブを 1 つにまとめるための jobId。
 * ingestionId は POST のたびに変わるので使えない。BullMQ の custom jobId は `:` を含められないため `-` でつなぐ
 */
export function ingestionJobId(season: number): string {
  return `ingestion-season-${season}`;
}
