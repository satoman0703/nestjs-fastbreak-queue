import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  type CreateIngestionDto,
  createIngestionSchema,
} from '@/ingestion/dto/create-ingestion.dto.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';

@Controller('ingestions')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  @HttpCode(202)
  async ingest(@Body({ schema: createIngestionSchema }) { season }: CreateIngestionDto) {
    const { id, status } = await this.ingestionService.enqueue(season);
    return { id, status };
  }

  /**
   * 1 シーズンで約 3 分かかり HTTP がタイムアウトすることを体感するための比較用で、非同期版を作った後も残す
   */
  @Post('sync')
  @HttpCode(200)
  async ingestSync(@Body({ schema: createIngestionSchema }) { season }: CreateIngestionDto) {
    const { id, status, gamesFetched } = await this.ingestionService.ingestSync(season);
    return { id, status, gamesFetched };
  }
}
