import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  CreateNginxServiceDto,
  PublishNginxServiceDto,
  RepublishNginxReleaseDto,
  RestartNginxServiceDto,
  UpdateNginxReleaseDto,
  UpdateNginxServiceDto,
} from './dto/nginx-service.dto';
import { NginxServicesService } from './nginx-services.service';

@Controller('nginx/services')
export class NginxServicesController {
  constructor(private readonly services: NginxServicesService) {}

  @Get()
  list(@Query('serverId') serverId?: string) {
    return this.services.list(serverId);
  }

  @Post()
  create(@Body() dto: CreateNginxServiceDto) {
    return this.services.create(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.services.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateNginxServiceDto) {
    return this.services.update(id, dto);
  }

  @Delete(':id')
  softDelete(@Param('id') id: string) {
    return this.services.softDelete(id);
  }

  @Post(':id/publish')
  publish(@Param('id') id: string, @Body() dto: PublishNginxServiceDto) {
    return this.services.publish(id, dto);
  }

  @Post(':id/restart')
  restart(@Param('id') id: string, @Body() dto: RestartNginxServiceDto) {
    return this.services.restart(id, dto.trustHostKey);
  }

  @Get(':id/releases')
  listReleases(@Param('id') id: string) {
    return this.services.listReleases(id);
  }

  @Get(':id/releases/:releaseId/download')
  async download(
    @Param('id') id: string,
    @Param('releaseId') releaseId: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    const result = await this.services.openReleaseDownload(id, releaseId);
    res.set({
      'Content-Type': result.contentType,
      'Content-Disposition': result.contentDisposition,
    });
    return new StreamableFile(result.stream);
  }

  @Get(':id/releases/:releaseId')
  getRelease(@Param('id') id: string, @Param('releaseId') releaseId: string) {
    return this.services.getRelease(id, releaseId);
  }

  @Patch(':id/releases/:releaseId')
  updateRelease(
    @Param('id') id: string,
    @Param('releaseId') releaseId: string,
    @Body() dto: UpdateNginxReleaseDto,
  ) {
    return this.services.updateRelease(id, releaseId, dto.remark);
  }

  @Delete(':id/releases/:releaseId')
  softDeleteRelease(@Param('id') id: string, @Param('releaseId') releaseId: string) {
    return this.services.softDeleteRelease(id, releaseId);
  }

  @Post(':id/releases/:releaseId/republish')
  republish(
    @Param('id') id: string,
    @Param('releaseId') releaseId: string,
    @Body() dto: RepublishNginxReleaseDto,
  ) {
    return this.services.republish(id, releaseId, dto.trustHostKey);
  }
}
