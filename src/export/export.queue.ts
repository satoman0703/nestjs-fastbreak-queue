import type { JobsOptions } from 'bullmq';

/**
 * エクスポートのキュー名。execute / batch / complete の 3 段をジョブ名で分け、同じキューに載せる
 */
export const EXPORT_QUEUE = 'export';

export type ExportJobName = 'execute' | 'batch' | 'complete';

/**
 * execute と complete は exportId だけ。batch は何番目の Batch か（Export.seasons の 1 始まりの位置）も載せる
 */
export type ExportJobData = { exportId: string; batchNumber?: number };

/**
 * batch と complete のリトライ。集計と連結は DB だけで終わり、待てば直る外部の制限も無いので、短い間隔で 3 回まで試す
 */
export const EXPORT_JOB_RETRY = {
  attempts: 3,
  backoff: { type: 'exponential', delay: 1_000 },
} as const satisfies Pick<JobsOptions, 'attempts' | 'backoff'>;

export function exportExecuteJobId(exportId: string): string {
  return `export-${exportId}`;
}

export function exportBatchJobId(exportId: string, batchNumber: number): string {
  return `export-${exportId}-batch-${batchNumber}`;
}
