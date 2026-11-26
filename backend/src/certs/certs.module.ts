import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ArchiveModule } from '../archive/archive.module';
import { CaModule } from '../ca/ca.module';
import { CertsController } from './certs.controller';
import { CertsService } from './certs.service';
import { IssuedCertificateEntity } from './issued-certificate.entity';

@Module({
  imports: [CaModule, ArchiveModule, TypeOrmModule.forFeature([IssuedCertificateEntity])],
  controllers: [CertsController],
  providers: [CertsService],
  exports: [CertsService],
})
export class CertsModule {}
