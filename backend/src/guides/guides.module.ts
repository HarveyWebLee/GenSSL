import { Module } from '@nestjs/common';
import { CaModule } from '../ca/ca.module';
import { GuidesController } from './guides.controller';
import { GuidesService } from './guides.service';

@Module({
  imports: [CaModule],
  controllers: [GuidesController],
  providers: [GuidesService],
})
export class GuidesModule {}
