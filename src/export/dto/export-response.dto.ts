import type { Export } from '@/generated/prisma/client.js';

/**
 * GET /api/exports/:id のレスポンス。CSV は大きくなりうるので、進み具合だけを返す
 */
export type ExportResponse = Omit<Export, 'updatedAt' | 'csv'>;

/**
 * POST /api/exports のレスポンス
 */
export type EnqueueExportResponse = Pick<Export, 'id' | 'status'>;
