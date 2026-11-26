import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArchiveModule } from '../archive/archive.module';
import { IssuedCertificateEntity } from '../certs/issued-certificate.entity';
import { CaController } from './ca.controller';
import { CaService } from './ca.service';
import { RootCaEntity } from './root-ca.entity';

@Module({
  imports: [TypeOrmModule.forFeature([RootCaEntity, IssuedCertificateEntity]), ArchiveModule],
  controllers: [CaController],
  providers: [CaService],
  exports: [CaService],
})
export class CaModule {}
