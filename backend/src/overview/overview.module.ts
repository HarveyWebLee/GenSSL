import { Module } from '@nestjs/common';
import { ArchiveModule } from '../archive/archive.module';
import { CaModule } from '../ca/ca.module';
import { CertsModule } from '../certs/certs.module';
import { ServersModule } from '../servers/servers.module';
import { DeployModule } from '../deploy/deploy.module';
import { StorageModule } from '../storage/storage.module';
import { OverviewController } from './overview.controller';
import { OverviewService } from './overview.service';

@Module({
  imports: [CaModule, CertsModule, ServersModule, StorageModule, ArchiveModule, DeployModule],
  controllers: [OverviewController],
  providers: [OverviewService],
})
export class OverviewModule {}
