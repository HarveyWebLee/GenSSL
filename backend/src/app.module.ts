import { Module } from '@nestjs/common';
import { HealthController } from './health/health.controller';
import { CaModule } from './ca/ca.module';
import { CertsModule } from './certs/certs.module';
import { NginxModule } from './nginx/nginx.module';
import { GuidesModule } from './guides/guides.module';

@Module({
  imports: [CaModule, CertsModule, NginxModule, GuidesModule],
  controllers: [HealthController],
})
export class AppModule {}
