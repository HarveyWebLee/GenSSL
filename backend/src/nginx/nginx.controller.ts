import { Body, Controller, Post } from '@nestjs/common';
import { NginxService } from './nginx.service';
import { GenerateNginxDto } from './dto/generate-nginx.dto';

@Controller('nginx')
export class NginxController {
  constructor(private readonly nginxService: NginxService) {}

  @Post('config')
  generate(@Body() dto: GenerateNginxDto) {
    return this.nginxService.generate(dto);
  }
}
