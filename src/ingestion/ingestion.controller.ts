import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import {
  type CreateIngestionDto,
  createIngestionSchema,
} from '@/ingestion/dto/create-ingestion.dto.js';
import { IngestionService } from '@/ingestion/ingestion.service.js';
import { PrismaService } from '@/prisma/prisma.service.js';

@Controller('ingestions')
export class IngestionController {
  constructor(
    private readonly ingestionService: IngestionService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * 取り込みが終わるまでレスポンスを返さない同期版。
   * 1 シーズンで約 3 分かかり HTTP がタイムアウトすることを体感するための比較用で、非同期版を作った後も残す
   */
  @Post('sync')
  @HttpCode(200)
  async ingestSync(@Body({ schema: createIngestionSchema }) { season }: CreateIngestionDto) {
    const { id } = await this.ingestionService.create(season);
    await this.ingestionService.run(id);
    const { status, gamesFetched } = await this.prisma.ingestion.findUniqueOrThrow({
      where: { id },
    });
    return { id, status, gamesFetched };
  }
}
