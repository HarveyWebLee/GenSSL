import { Module } from '@nestjs/common';
import { SshCryptoService } from './ssh-crypto';
import { Ssh2ClientFactory } from './ssh2-client';
import { SshService } from './ssh.service';
import { SSH_CLIENT_FACTORY } from './ssh.types';

@Module({
  providers: [
    SshCryptoService,
    SshService,
    {
      provide: SSH_CLIENT_FACTORY,
      useClass: Ssh2ClientFactory,
    },
  ],
  exports: [SshCryptoService, SshService, SSH_CLIENT_FACTORY],
})
export class SshModule {}
