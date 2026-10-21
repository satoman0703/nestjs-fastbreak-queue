import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import {
  type CreateIngestionDto,
  createIngestionSchema,
} from '@/ingestion/dto/create-ingestion.dto.js';
import type {
  EnqueueIngestionResponse,
  IngestionResponse,
  SyncIngestionResponse,
} from '@/ingestion/dto/ingestion-response.dto.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';

@Controller('ingestions')
export class IngestionController {
  constructor(private readonly ingestionService: IngestionService) {}

  @Post()
  @HttpCode(202)
  async ingest(
    @Body({ schema: createIngestionSchema }) { season }: CreateIngestionDto,
  ): Promise<EnqueueIngestionResponse> {
    return this.ingestionService.enqueue(season);
  }

  /**
   * POST で受け取った id で、取り込みの進み具合を見に来るためのエンドポイント。
   * id が uuid の形でなければ、DB を引く前に 400 で返す
   */
  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<IngestionResponse> {
    return this.ingestionService.findById(id);
  }

  /**
   * 1 シーズンで約 3 分かかり HTTP がタイムアウトすることを体感するための比較用で、非同期版を作った後も残す
   */
  @Post('sync')
  @HttpCode(200)
  async ingestSync(
    @Body({ schema: createIngestionSchema }) { season }: CreateIngestionDto,
  ): Promise<SyncIngestionResponse> {
    return this.ingestionService.ingestSync(season);
  }
}
