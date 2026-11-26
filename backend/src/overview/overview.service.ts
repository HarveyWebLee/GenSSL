import { Injectable } from '@nestjs/common';
import { ArchiveService } from '../archive/archive.service';
import { CaService } from '../ca/ca.service';
import { CertsService } from '../certs/certs.service';
import { ServersService } from '../servers/servers.service';
import { DeployService } from '../deploy/deploy.service';
import { RustfsService } from '../storage/rustfs.service';

@Injectable()
export class OverviewService {
  constructor(
    private readonly caService: CaService,
    private readonly certsService: CertsService,
    private readonly serversService: ServersService,
    private readonly rustfs: RustfsService,
    private readonly archiveService: ArchiveService,
    private readonly deployService: DeployService,
  ) {}

  async getOverview() {
    const [cas, certs, serverCount, storageCounts, deploys] = await Promise.all([
      this.caService.list(),
      this.certsService.list(),
      this.serversService.count(),
      this.archiveService.countByKind(),
      this.deployService.list(),
    ]);

    const statuses = certs.items.map((item) => item.status);
    return {
      cas: {
        total: cas.items.length,
        active: cas.activeCount,
        retired: cas.retiredCount,
        ready: cas.activeCount > 0,
        items: cas.items.map((item) => ({
          id: item.id,
          name: item.name,
          commonName: item.commonName,
          status: item.status,
          notAfter: item.notAfter,
          publicFileName: item.publicFileName,
          certificateCount: item.certificateCount,
          validCertificateCount: item.validCertificateCount,
          needsReissueCount: item.needsReissueCount,
          needsRegenerateCount: item.needsRegenerateCount,
          generation: item.generation,
          regeneratedAt: item.regeneratedAt,
          archive: item.archive,
        })),
      },
      certificateCount: certs.items.length,
      validCertificateCount: statuses.filter((status) => status === 'valid').length,
      needsReissueCount: statuses.filter((status) => status === 'needs_reissue').length,
      needsRegenerateCount: statuses.filter((status) => status === 'needs_regenerate').length,
      expiredCertificateCount: statuses.filter((status) => status === 'expired').length,
      staleDeployCount: deploys.items.filter((item) => item.stale).length,
      regeneratedActiveCaCount: cas.items.filter((item) => item.status === 'active' && (item.generation ?? 1) > 1).length,
      serverCount,
      storage: {
        ...this.rustfs.getStatus(),
        archive: storageCounts.archive,
        deploy: storageCounts.deploy,
      },
    };
  }

  async getArchiveLibrary() {
    const [cas, certs] = await Promise.all([this.caService.list(), this.certsService.list()]);
    let rustfsFiles: { cas: unknown[]; certs: unknown[] } | null = null;
    const storage = this.rustfs.getStatus();
    if (storage.ready) {
      const listed = await this.archiveService.listLibrary();
      rustfsFiles = { cas: listed.cas, certs: listed.certs };
    }
    return {
      storageKind: 'archive' as const,
      storageLabel: '证书库',
      prefix: 'archive/',
      storage,
      rustfsFiles,
      cas: cas.items.map((item) => ({
        id: item.id,
        name: item.name,
        status: item.status,
        publicFileName: item.publicFileName,
        generation: item.generation,
        regeneratedAt: item.regeneratedAt,
        archive: item.archive,
      })),
      certificates: certs.items.map((item) => ({
        id: item.id,
        name: item.name,
        ca: item.ca,
        publicFileName: item.publicFileName,
        keyFileName: item.keyFileName,
        status: item.status,
        statusLabel: item.statusLabel,
        archive: item.archive,
      })),
      note: '证书库用于保存平台管理的证书档案，与「部署到服务器 cert 目录」（deploy/）完全分开。rootCA.key 不会出现在这里。',
    };
  }
}
