import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import { ArchiveService } from '../archive/archive.service';
import { CaService } from './ca.service';
import { CreateCaDto } from './dto/create-ca.dto';
import { DownloadCaQueryDto } from './dto/download-ca.dto';
import type { RootCaSummary } from './ca.types';

@Controller('ca')
export class CaController {
  constructor(
    private readonly caService: CaService,
    private readonly archiveService: ArchiveService,
  ) {}

  @Get()
  list() {
    return this.caService.list();
  }

  @Post()
  async create(@Body() dto: CreateCaDto): Promise<RootCaSummary> {
    const created = await this.caService.create(dto);
    return this.tryArchive(created.id);
  }

  @Get(':id/download')
  async download(
    @Param('id') id: string,
    @Query() query: DownloadCaQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const { stream, contentType, contentDisposition } = await this.caService.openCertificateFile(id, {
      filename: query.filename,
      format: query.format,
    });
    res.set({
      'Content-Type': contentType,
      'Content-Disposition': contentDisposition,
    });
    return new StreamableFile(stream);
  }

  @Post(':id/archive')
  archive(@Param('id') id: string) {
    return this.tryArchive(id, true);
  }

  @Post(':id/retire')
  retire(@Param('id') id: string) {
    return this.caService.retire(id);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.caService.get(id);
  }

  private async tryArchive(id: string, required = false): Promise<RootCaSummary> {
    const current = await this.caService.get(id);
    try {
      this.archiveService.assertReady();
      const { row } = await this.caService.loadPublicMaterial(id);
      const stored = await this.archiveService.archiveRootCertificate(id, row.certificatePem, true);
      return this.caService.markArchived(id, stored.objectKey);
    } catch (error) {
      if (required) {
        throw error;
      }
      return current;
    }
  }
}
