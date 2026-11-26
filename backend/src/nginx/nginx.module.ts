import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CaModule } from '../ca/ca.module';
import { ServersModule } from '../servers/servers.module';
import { SshModule } from '../ssh/ssh.module';
import { StorageModule } from '../storage/storage.module';
import { NginxServiceReleaseEntity } from './entities/nginx-service-release.entity';
import { NginxServiceEntity } from './entities/nginx-service.entity';
import { NginxController } from './nginx.controller';
import { NginxService } from './nginx.service';
import { NginxServicesController } from './nginx-services.controller';
import { NginxServicesService } from './nginx-services.service';

@Module({
  imports: [
    CaModule,
    ServersModule,
    SshModule,
    StorageModule,
    TypeOrmModule.forFeature([NginxServiceEntity, NginxServiceReleaseEntity]),
  ],
  controllers: [NginxController, NginxServicesController],
  providers: [NginxService, NginxServicesService],
  exports: [NginxService, NginxServicesService],
})
export class NginxModule {}
