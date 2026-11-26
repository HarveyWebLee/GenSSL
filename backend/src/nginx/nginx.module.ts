import { Module } from '@nestjs/common';
import { CaModule } from '../ca/ca.module';
import { NginxController } from './nginx.controller';
import { NginxService } from './nginx.service';

@Module({
  imports: [CaModule],
  controllers: [NginxController],
  providers: [NginxService],
})
export class NginxModule {}
