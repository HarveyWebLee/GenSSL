import { Body, Controller, Get, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CaService } from './ca.service';
import { CreateCaDto } from './dto/create-ca.dto';
import { DownloadCaQueryDto } from './dto/download-ca.dto';
import type { CaDetails, CaStatus } from './ca.types';

@Controller('ca')
export class CaController {
  constructor(private readonly caService: CaService) {}

  @Get()
  getStatus(): Promise<CaStatus> {
    return this.caService.getStatus();
  }

  @Post()
  create(@Body() dto: CreateCaDto): Promise<CaDetails> {
    return this.caService.create(dto);
  }

  @Get('download')
  async download(
    @Query() query: DownloadCaQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, contentType, contentDisposition } =
      await this.caService.openCertificateFile({
        filename: query.filename,
        format: query.format,
      });
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition,
    });
    return new StreamableFile(stream);
  }
}
