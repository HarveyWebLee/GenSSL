import { Module } from '@nestjs/common';
import { StorageModule } from '../storage/storage.module';
import { ArchiveService } from './archive.service';

@Module({
  imports: [StorageModule],
  providers: [ArchiveService],
  exports: [ArchiveService],
})
export class ArchiveModule {}
