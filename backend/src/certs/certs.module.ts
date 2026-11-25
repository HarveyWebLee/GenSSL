import { Module } from '@nestjs/common';
import { CertsController } from './certs.controller';
import { CertsService } from './certs.service';

@Module({
  controllers: [CertsController],
  providers: [CertsService],
  exports: [CertsService],
})
export class CertsModule {}
