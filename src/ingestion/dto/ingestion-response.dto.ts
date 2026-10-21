import type { Ingestion } from '@/generated/prisma/client.js';

/**
 * GET /api/ingestions/:id のレスポンス。updatedAt はクライアントが使う場面が無いので返さない
 */
export type IngestionResponse = Omit<Ingestion, 'updatedAt'>;

/**
 * POST /api/ingestions のレスポンス。処理前なので、状態を見に来るための id と PENDING だけを返す
 */
export type EnqueueIngestionResponse = Pick<Ingestion, 'id' | 'status'>;

/**
 * POST /api/ingestions/sync のレスポンス
 */
export type SyncIngestionResponse = Pick<Ingestion, 'id' | 'status' | 'gamesFetched'>;
