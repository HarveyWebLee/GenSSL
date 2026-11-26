import { Controller, Get, Query } from '@nestjs/common';
import { GuidesService } from './guides.service';

@Controller('guides')
export class GuidesController {
  constructor(private readonly guidesService: GuidesService) {}

  @Get('windows-trust')
  getWindowsTrustGuide(@Query('caId') caId?: string) {
    return this.guidesService.getWindowsTrustGuide(caId);
  }
}
