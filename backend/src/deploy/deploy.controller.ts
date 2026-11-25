import {
  BadRequestException,
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
import { buildContentDisposition } from '../ca/ca-filename';
import { assertSafeObjectKey } from '../storage/upload-guard';
import { DeployService } from './deploy.service';
import { CreateDeployDto } from './dto/create-deploy.dto';

@Controller()
export class DeployController {
  constructor(private readonly deployService: DeployService) {}

  @Get('deploys')
  list() {
    return this.deployService.list();
  }

  @Post('deploys')
  deploy(@Body() dto: CreateDeployDto) {
    return this.deployService.deploy(dto);
  }

  @Get('deploys/:id')
  get(@Param('id') id: string) {
    return this.deployService.get(id);
  }

  @Get('servers/:serverId/paths/:pathId/files')
  listTargetFiles(@Param('serverId') serverId: string, @Param('pathId') pathId: string) {
    return this.deployService.listTargetFiles(serverId, pathId);
  }

  @Get('storage/objects')
  async downloadObject(
    @Query('key') key: string,
    @Res({ passthrough: true }) res: Response,
  ): Promise<StreamableFile> {
    if (!key?.trim()) {
      throw new BadRequestException('请指定要下载的对象键。');
    }
    const objectKey = assertSafeObjectKey(key);
    const result = await this.deployService.openStoredFile(objectKey);
    const fileName = objectKey.split('/').pop() || 'download';
    const isKey = /\.key$/i.test(fileName);
    const headers: Record<string, string> = {
      'Content-Type': result.contentType || 'application/octet-stream',
      'Content-Disposition': buildContentDisposition(fileName),
    };
    if (isKey) {
      headers['X-GenSSL-Warning'] = encodeURIComponent(
        '此文件是服务器私钥，只用于部署到对应 Nginx，不要分发给客户端。',
      );
    }
    res.set(headers);
    return new StreamableFile(result.stream);
  }
}
