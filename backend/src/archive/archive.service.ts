import { BadRequestException, Injectable } from '@nestjs/common';
import {
  ARCHIVE_ROOT,
  DEPLOY_ROOT,
  buildArchiveCaObjectKey,
  buildArchiveCaPrefix,
  buildArchiveCertObjectKey,
  buildArchiveCertPrefix,
  classifyStorageKind,
  storageKindLabel,
} from '../storage/object-key';
import { assertSafeObjectKey, isForbiddenUploadName } from '../storage/upload-guard';
import { RustfsService } from '../storage/rustfs.service';

@Injectable()
export class ArchiveService {
  constructor(private readonly rustfs: RustfsService) {}

  getStatus() {
    return this.rustfs.getStatus();
  }

  assertReady(): void {
    this.rustfs.assertReady();
  }

  async archiveRootCertificate(caId: string, certPem: string, overwrite = true): Promise<{ objectKey: string; size: number }> {
    this.assertReady();
    if (certPem.includes('PRIVATE KEY')) {
      throw new BadRequestException('拒绝将包含私钥的材料写入证书库。');
    }
    const objectKey = buildArchiveCaObjectKey(caId, 'rootCA.crt');
    if (!overwrite && (await this.rustfs.objectExists(objectKey))) {
      return { objectKey, size: 0 };
    }
    const stored = await this.rustfs.putObject(objectKey, certPem, 'application/x-x509-ca-cert');
    return { objectKey: stored.key, size: stored.size };
  }

  async archiveServerCertificate(options: {
    caId: string;
    certId: string;
    certFileName: string;
    keyFileName: string;
    certPem: string;
    keyPem: string;
  }): Promise<{ prefix: string; certObjectKey: string; keyObjectKey: string }> {
    this.assertReady();
    if (isForbiddenUploadName(options.certFileName) || isForbiddenUploadName(options.keyFileName)) {
      throw new BadRequestException('禁止将 rootCA.key 写入证书库。');
    }
    if (options.certPem.includes('PRIVATE KEY')) {
      throw new BadRequestException('服务器证书公钥不得包含私钥。');
    }
    const certObjectKey = buildArchiveCertObjectKey(options.caId, options.certId, options.certFileName);
    const keyObjectKey = buildArchiveCertObjectKey(options.caId, options.certId, options.keyFileName);
    await this.rustfs.putObject(certObjectKey, options.certPem, 'application/x-x509-ca-cert');
    await this.rustfs.putObject(keyObjectKey, options.keyPem, 'application/x-pem-file');
    return {
      prefix: buildArchiveCertPrefix(options.caId, options.certId),
      certObjectKey,
      keyObjectKey,
    };
  }

  async listArchivePrefix(prefix: string) {
    this.assertReady();
    return this.rustfs.listPrefix(prefix);
  }

  async listLibrary() {
    this.assertReady();
    const [cas, certs] = await Promise.all([
      this.rustfs.listPrefix(`${ARCHIVE_ROOT}/cas`),
      this.rustfs.listPrefix(`${ARCHIVE_ROOT}/certs`),
    ]);
    return {
      storageKind: 'archive' as const,
      storageLabel: storageKindLabel('archive'),
      prefix: `${ARCHIVE_ROOT}/`,
      cas,
      certs,
    };
  }

  async countByKind() {
    const status = this.rustfs.getStatus();
    if (!status.ready) {
      return {
        archive: { storageKind: 'archive' as const, storageLabel: storageKindLabel('archive'), prefix: `${ARCHIVE_ROOT}/`, objectCount: null as number | null },
        deploy: { storageKind: 'deploy' as const, storageLabel: storageKindLabel('deploy'), prefix: `${DEPLOY_ROOT}/`, objectCount: null as number | null },
      };
    }
    const [archive, deploy] = await Promise.all([
      this.rustfs.listPrefix(ARCHIVE_ROOT),
      this.rustfs.listPrefix(DEPLOY_ROOT),
    ]);
    return {
      archive: {
        storageKind: 'archive' as const,
        storageLabel: storageKindLabel('archive'),
        prefix: `${ARCHIVE_ROOT}/`,
        objectCount: archive.length,
      },
      deploy: {
        storageKind: 'deploy' as const,
        storageLabel: storageKindLabel('deploy'),
        prefix: `${DEPLOY_ROOT}/`,
        objectCount: deploy.length,
      },
    };
  }

  async openStoredFile(objectKey: string) {
    const key = assertSafeObjectKey(objectKey);
    classifyStorageKind(key);
    return this.rustfs.getObjectStream(key);
  }

  async readText(objectKey: string): Promise<string> {
    const key = assertSafeObjectKey(objectKey);
    classifyStorageKind(key);
    return this.rustfs.getObjectText(key);
  }

  caArchivePrefix(caId: string): string {
    return buildArchiveCaPrefix(caId);
  }

  certArchivePrefix(caId: string, certId: string): string {
    return buildArchiveCertPrefix(caId, certId);
  }
}
