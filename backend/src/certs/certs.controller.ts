import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CertsService } from './certs.service';
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

  @Get(':name')
  getDetail(@Param('name') name: string) {
    return this.certsService.getDetail(name);
  }

  @Get(':name/download')
  download(@Param('name') name: string) {
    return this.certsService.prepareDownload(name);
  }
}
