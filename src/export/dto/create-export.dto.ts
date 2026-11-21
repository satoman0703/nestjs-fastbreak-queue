import { z } from 'zod';
import { MAX_SEASON, MIN_SEASON } from '@/ingestion/dto/create-ingestion.dto.js';

export const createExportSchema = z.object({
  seasons: z.array(z.number().int().min(MIN_SEASON).max(MAX_SEASON)).min(1),
});

export type CreateExportDto = z.infer<typeof createExportSchema>;
