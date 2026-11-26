import { Body, Controller, Delete, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CertsService } from './certs.service';
import { DownloadCertQueryDto } from './dto/download-cert.dto';
import { IssueCertDto } from './dto/issue-cert.dto';
import { RegenerateCertDto, RegenerateCertsBatchDto } from './dto/regenerate-cert.dto';

@Controller('certs')
export class CertsController {
  constructor(private readonly certsService: CertsService) {}

  @Get()
  list() {
    return this.certsService.list();
  }

  @Post()
  issue(@Body() dto: IssueCertDto) {
    return this.certsService.issue(dto);
  }

  @Post('regenerate-batch')
  regenerateBatch(@Body() dto: RegenerateCertsBatchDto) {
    return this.certsService.regenerateMany(dto);
  }

  @Post(':id/regenerate')
  regenerate(@Param('id') id: string, @Body() dto: RegenerateCertDto) {
    return this.certsService.regenerate(id, dto);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query() query: DownloadCertQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.certsService.openDownload(id, {
      part: query.part,
      filename: query.filename,
      format: query.format,
    });
    const headers: Record<string, string> = {
      'Content-Type': result.contentType,
      'Content-Disposition': result.contentDisposition,
    };
    if (result.warning) {
      headers['X-GenSSL-Warning'] = encodeURIComponent(result.warning);
    }
    res.set(headers);
    return new StreamableFile(result.stream);
  }

  @Delete(':id')
  softDelete(@Param('id') id: string) {
    return this.certsService.softDelete(id);
  }

  @Get(':id')
  getDetail(@Param('id') id: string) {
    return this.certsService.getDetail(id);
  }
}
