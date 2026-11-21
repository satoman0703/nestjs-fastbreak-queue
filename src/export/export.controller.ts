import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { type CreateExportDto, createExportSchema } from '@/export/dto/create-export.dto.js';
import type { EnqueueExportResponse, ExportResponse } from '@/export/dto/export-response.dto.js';
import { ExportService } from '@/export/export.service.js';

@Controller('exports')
export class ExportController {
  constructor(private readonly exportService: ExportService) {}

  @Post()
  @HttpCode(202)
  async create(
    @Body({ schema: createExportSchema }) { seasons }: CreateExportDto,
  ): Promise<EnqueueExportResponse> {
    return this.exportService.enqueue(seasons);
  }

  @Get(':id')
  async findOne(@Param('id', ParseUUIDPipe) id: string): Promise<ExportResponse> {
    return this.exportService.findById(id);
  }
}
