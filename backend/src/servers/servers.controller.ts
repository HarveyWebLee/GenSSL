import { Body, Controller, Delete, Get, Param, Patch, Post } from '@nestjs/common';
import {
  CreateServerDto,
  CreateServerPathDto,
  TestServerConnectionDto,
  UpdateServerDto,
  UpdateServerPathDto,
} from './dto/server.dto';
import { ServersService } from './servers.service';

@Controller('servers')
export class ServersController {
  constructor(private readonly serversService: ServersService) {}

  @Get()
  list() {
    return this.serversService.list();
  }

  @Post()
  create(@Body() dto: CreateServerDto) {
    return this.serversService.create(dto);
  }

  @Post('test-connection')
  testConnection(@Body() dto: TestServerConnectionDto) {
    return this.serversService.testConnection(dto);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.serversService.get(id);
  }

  @Patch(':id')
  update(@Param('id') id: string, @Body() dto: UpdateServerDto) {
    return this.serversService.update(id, dto);
  }

  @Delete(':id')
  remove(@Param('id') id: string) {
    return this.serversService.remove(id);
  }

  @Post(':id/test-connection')
  testServerConnection(@Param('id') id: string, @Body() dto: TestServerConnectionDto) {
    return this.serversService.testConnection(dto, id);
  }

  @Post(':id/paths')
  addPath(@Param('id') id: string, @Body() dto: CreateServerPathDto) {
    return this.serversService.addPath(id, dto);
  }

  @Patch(':id/paths/:pathId')
  updatePath(
    @Param('id') id: string,
    @Param('pathId') pathId: string,
    @Body() dto: UpdateServerPathDto,
  ) {
    return this.serversService.updatePath(id, pathId, dto);
  }

  @Delete(':id/paths/:pathId')
  removePath(@Param('id') id: string, @Param('pathId') pathId: string) {
    return this.serversService.removePath(id, pathId);
  }
}
