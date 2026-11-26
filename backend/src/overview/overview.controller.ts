import { Controller, Get } from '@nestjs/common';
import { OverviewService } from './overview.service';

@Controller()
export class OverviewController {
  constructor(private readonly overviewService: OverviewService) {}

  @Get('overview')
  getOverview() {
    return this.overviewService.getOverview();
  }

  @Get('archive')
  getArchiveLibrary() {
    return this.overviewService.getArchiveLibrary();
  }
}
