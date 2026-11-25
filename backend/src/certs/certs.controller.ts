import { Body, Controller, Get, Param, Post, Query, Res, StreamableFile } from '@nestjs/common';
import type { Response } from 'express';
import { CertsService } from './certs.service';
import { DownloadCertQueryDto } from './dto/download-cert.dto';
import { IssueCertDto } from './dto/issue-cert.dto';

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

  @Get(':name/download')
  async download(
    @Param('name') name: string,
    @Query() query: DownloadCertQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.certsService.openDownload(name, {
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

  @Get(':name')
  getDetail(@Param('name') name: string) {
    return this.certsService.getDetail(name);
  }
}
