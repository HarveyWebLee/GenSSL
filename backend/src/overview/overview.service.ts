import { Injectable } from '@nestjs/common';
import { CaService } from '../ca/ca.service';
import type { CaDetails } from '../ca/ca.types';
import { CertsService } from '../certs/certs.service';
import { ServersService } from '../servers/servers.service';
import { RustfsService } from '../storage/rustfs.service';

function isCaDetails(status: Awaited<ReturnType<CaService['getStatus']>>): status is CaDetails {
  return status.exists === true && status.incomplete !== true;
}

@Injectable()
export class OverviewService {
  constructor(
    private readonly caService: CaService,
    private readonly certsService: CertsService,
    private readonly serversService: ServersService,
    private readonly rustfs: RustfsService,
  ) {}

  async getOverview() {
    const [ca, certificateCount, serverCount] = await Promise.all([
      this.caService.getStatus(),
      this.certsService.count(),
      this.serversService.count(),
    ]);

    const details = isCaDetails(ca) ? ca : undefined;

    return {
      ca: {
        exists: ca.exists === true,
        ready: Boolean(details),
        incomplete: ca.exists === true && ca.incomplete === true,
        commonName: details?.subject.commonName,
        notBefore: details?.notBefore,
        notAfter: details?.notAfter,
        publicFileName: details?.publicFileName,
      },
      certificateCount,
      serverCount,
      storage: this.rustfs.getStatus(),
    };
  }
}
