import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArchiveModule } from '../archive/archive.module';
import { CaModule } from '../ca/ca.module';
import { CertsModule } from '../certs/certs.module';
import { ServersModule } from '../servers/servers.module';
import { SshModule } from '../ssh/ssh.module';
import { StorageModule } from '../storage/storage.module';
import { DeployController } from './deploy.controller';
import { DeployRecordEntity } from './deploy-record.entity';
import { DeployService } from './deploy.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([DeployRecordEntity]),
    CertsModule,
    ServersModule,
    StorageModule,
    CaModule,
    ArchiveModule,
    SshModule,
  ],
  controllers: [DeployController],
  providers: [DeployService],
  exports: [DeployService],
})
export class DeployModule {}
