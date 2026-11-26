import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { PassThrough, Readable } from 'node:stream';
import archiver from 'archiver';
import * as forge from 'node-forge';
import { Repository } from 'typeorm';
import { ArchiveService } from '../archive/archive.service';
import { CaService } from '../ca/ca.service';
import {
  buildContentDisposition,
  contentTypeForFormat,
  sanitizePublicBasename,
} from '../ca/ca-filename';
import type { RootCaLifecycleStatus } from '../ca/root-ca.entity';
import { IssueCertDto } from './dto/issue-cert.dto';
import { IssuedCertificateEntity } from './issued-certificate.entity';
import {
  deriveServerKeyFileName,
  resolveServerCertDownloadName,
  resolveServerCertPublicFileName,
  resolveServerKeyDownloadName,
} from './cert-filename';
import {
  computeCertificateStatus,
  certificateStatusLabel,
  type CertificateLifecycleStatus,
} from './cert-status';
import {
  attrsToSubject,
  generateRsaKeyPair,
  generateSerialNumber,
  issueServerCertificate,
  SERVER_CERT_DEFAULTS,
  sha256Fingerprint,
  verifyServerCertificate,
  type CertVerification,
} from './issue-server-cert';
import { normalizeSan, type NormalizedSan } from './san';

export interface CertificateCaRef {
  id: string;
  name: string;
  commonName: string;
  status: RootCaLifecycleStatus;
  publicFileName: string;
}

export interface CertificateSummary {
  id: string;
  name: string;
  commonName: string;
  ips: string[];
  dnsNames: string[];
  sanDisplay: string;
  days: number;
  notBefore: string;
  notAfter: string;
  serialNumber: string;
  fingerprintSha256: string;
  publicFileName: string;
  keyFileName: string;
  publicKeyBits: number;
  createdAt: string;
  ca: CertificateCaRef;
  status: CertificateLifecycleStatus;
  statusLabel: string;
  archive: {
    storageKind: 'archive';
    storageLabel: '证书库';
    uploaded: boolean;
    objectPrefix: string | null;
    certObjectKey: string | null;
    keyObjectKey: string | null;
    uploadedAt: string | null;
  };
}

export interface CertificateDetail extends CertificateSummary {
  subject: Record<string, string>;
  issuer: Record<string, string>;
  signatureAlgorithm: string;
  isCA: boolean;
  verification: CertVerification;
}

export interface FileDownload {
  stream: Readable | PassThrough;
  filename: string;
  contentType: string;
  contentDisposition: string;
  warning?: string;
}

@Injectable()
export class CertsService {
  constructor(
    private readonly caService: CaService,
    private readonly archiveService: ArchiveService,
    @InjectRepository(IssuedCertificateEntity)
    private readonly repo: Repository<IssuedCertificateEntity>,
  ) {}

  async list(): Promise<{ items: CertificateSummary[] }> {
    const rows = await this.repo.find({ relations: { ca: true }, order: { createdAt: 'DESC' } });
    const items = [];
    for (const row of rows) {
      items.push(this.toSummary(await this.hydrateCa(row)));
    }
    return { items };
  }

  async issue(dto: IssueCertDto): Promise<CertificateDetail> {
    this.archiveService.assertReady();
    const ca = await this.caService.loadSigningMaterial(dto.caId);
    const san = normalizeSan({ ips: dto.ips, dnsNames: dto.dnsNames });
    const caSubject = attrsToSubject(ca.cert.subject.attributes);
    const commonName = (dto.commonName?.trim() || san.ips[0]) as string;
    const name = this.resolveRecordName(dto.name, commonName, san.ips[0]);

    const existing = await this.repo.findOne({ where: { caId: ca.id, name } });
    if (existing) {
      throw new ConflictException(
        `根证书「${ca.name}」下已有名为「${name}」的服务器证书。请使用不同名称另行签发，以保留历史记录。`,
      );
    }

    const publicFileName = resolveServerCertPublicFileName(dto.publicFileName, {
      name,
      commonName,
      firstIp: san.ips[0],
    });
    const keyFileName = deriveServerKeyFileName(publicFileName, 'key');
    const days = dto.days ?? SERVER_CERT_DEFAULTS.days;
    const keySize = dto.keySize ?? SERVER_CERT_DEFAULTS.keySize;
    const keys = await generateRsaKeyPair(keySize);

    const existingSerials = new Set((await this.repo.find({ select: ['serialNumber'] })).map((row) => row.serialNumber));
    const issued = issueServerCertificate({
      caCert: ca.cert,
      caKey: ca.key,
      keys,
      ips: san.ips,
      dnsNames: san.dnsNames,
      subject: {
        country: (dto.country ?? caSubject.country ?? 'CN').toUpperCase(),
        stateOrProvince: dto.stateOrProvince ?? caSubject.stateOrProvince,
        locality: dto.locality ?? caSubject.locality,
        organization: dto.organization ?? caSubject.organization,
        organizationalUnit: dto.organizationalUnit ?? caSubject.organizationalUnit,
        commonName,
      },
      days,
      serialNumber: generateSerialNumber(existingSerials),
      hashAlgorithm: dto.hashAlgorithm ?? SERVER_CERT_DEFAULTS.hashAlgorithm,
    });

    const verification = verifyServerCertificate({
      cert: issued.cert,
      caCert: ca.cert,
      privateKey: keys.privateKey,
      expectedSan: san,
    });
    if (!verification.ok) {
      throw new InternalServerErrorException(
        `证书签发后校验未通过：${verification.messages.join('；') || '未知原因'}`,
      );
    }

    const id = randomUUID();
    const archived = await this.archiveService.archiveServerCertificate({
      caId: ca.id,
      certId: id,
      certFileName: publicFileName,
      keyFileName,
      certPem: issued.certPem,
      keyPem: issued.keyPem,
    });

    let signatureAlgorithm = 'sha256WithRSAEncryption';
    if (dto.hashAlgorithm === 'sha384') {
      signatureAlgorithm = 'sha384WithRSAEncryption';
    } else if (dto.hashAlgorithm === 'sha512') {
      signatureAlgorithm = 'sha512WithRSAEncryption';
    }

    const row = this.repo.create({
      id,
      caId: ca.id,
      name,
      commonName,
      ips: san.ips,
      dnsNames: san.dnsNames,
      days,
      notBefore: issued.notBefore,
      notAfter: issued.notAfter,
      serialNumber: String(issued.cert.serialNumber).toLowerCase(),
      fingerprintSha256: sha256Fingerprint(issued.cert),
      signatureAlgorithm,
      publicKeyBits: keySize,
      subject: attrsToSubject(issued.cert.subject.attributes) as Record<string, string>,
      publicFileName,
      keyFileName,
      sanDisplay: issued.sanDisplay,
      certificatePem: issued.certPem,
      archiveObjectPrefix: archived.prefix,
      archiveCertObjectKey: archived.certObjectKey,
      archiveKeyObjectKey: archived.keyObjectKey,
      archiveUploadedAt: new Date(),
    });
    await this.repo.save(row);
    return this.getDetail(id);
  }

  async getDetail(id: string): Promise<CertificateDetail> {
    const row = await this.findRecord(id);
    const { cert, certPem, row: caRow } = await this.caService.loadPublicMaterial(row.caId);
    const expected: NormalizedSan = { ips: row.ips, dnsNames: row.dnsNames };
    let privateKey: forge.pki.rsa.PrivateKey | undefined;
    try {
      if (row.archiveKeyObjectKey) {
        const keyPem = await this.archiveService.readText(row.archiveKeyObjectKey);
        privateKey = forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey;
      }
    } catch {
      privateKey = undefined;
    }
    const issuedCert = forge.pki.certificateFromPem(row.certificatePem);
    const verification = verifyServerCertificate({
      cert: issuedCert,
      caCert: cert,
      privateKey,
      expectedSan: expected,
    });
    if (!privateKey) {
      verification.messages = [...verification.messages, '未能从证书库读取服务器私钥，已跳过私钥匹配校验。'];
    }

    const summary = this.toSummary(row);
    return {
      ...summary,
      subject: row.subject,
      issuer: (caRow.subject ?? attrsToSubject(cert.subject.attributes)) as Record<string, string>,
      signatureAlgorithm: row.signatureAlgorithm,
      isCA: false,
      verification,
    };
  }

  async openDownload(
    id: string,
    options?: { part?: 'bundle' | 'cert' | 'key'; filename?: string; format?: string },
  ): Promise<FileDownload> {
    const row = await this.findRecord(id);
    if (!row.archiveCertObjectKey || !row.archiveKeyObjectKey) {
      throw new NotFoundException(`证书「${row.name}」尚未上传到证书库，无法下载。`);
    }
    const part = options?.part ?? 'bundle';

    if (part === 'cert') {
      const { filename, format } = resolveServerCertDownloadName({
        storedName: row.publicFileName,
        filename: options?.filename,
        format: options?.format,
      });
      const pem = row.certificatePem;
      return {
        stream: Readable.from(Buffer.from(pem, 'utf8')),
        filename,
        contentType: contentTypeForFormat(format),
        contentDisposition: buildContentDisposition(filename),
      };
    }

    if (part === 'key') {
      const { filename } = resolveServerKeyDownloadName({
        storedKeyName: row.keyFileName,
        filename: options?.filename,
        format: options?.format,
      });
      const keyPem = await this.archiveService.readText(row.archiveKeyObjectKey);
      return {
        stream: Readable.from(Buffer.from(keyPem, 'utf8')),
        filename,
        contentType: 'application/x-pem-file',
        contentDisposition: buildContentDisposition(filename),
        warning:
          '此文件是服务器私钥，只用于部署到对应 Nginx 服务器，不要分发给客户端，也不要与 rootCA.key 混淆。根 CA 私钥不会提供下载。',
      };
    }

    const zipName = this.bundleFileName(row, options?.filename);
    const certPem = row.certificatePem;
    const keyPem = await this.archiveService.readText(row.archiveKeyObjectKey);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const passthrough = new PassThrough();
    archive.on('error', (error) => {
      passthrough.destroy(error);
    });
    archive.pipe(passthrough);
    archive.append(certPem, { name: row.publicFileName });
    archive.append(keyPem, { name: row.keyFileName });
    void archive.finalize();

    return {
      stream: passthrough,
      filename: zipName,
      contentType: 'application/zip',
      contentDisposition: buildContentDisposition(zipName),
      warning:
        '压缩包中包含服务器证书与服务器私钥，只用于部署到对应 Nginx，不要分发给客户端。压缩包绝不包含 rootCA.key。',
    };
  }

  async readArchiveMaterial(id: string): Promise<{
    certPem: string;
    keyPem: string;
    publicFileName: string;
    keyFileName: string;
    caId: string;
  }> {
    const row = await this.findRecord(id);
    if (!row.archiveKeyObjectKey) {
      throw new NotFoundException(`证书「${row.name}」尚未进入证书库，无法部署。请先确认文件服务器可用后重新签发。`);
    }
    const keyPem = await this.archiveService.readText(row.archiveKeyObjectKey);
    return {
      certPem: row.certificatePem,
      keyPem,
      publicFileName: row.publicFileName,
      keyFileName: row.keyFileName,
      caId: row.caId,
    };
  }

  async findRecord(idOrName: string): Promise<IssuedCertificateEntity> {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const row = uuidRe.test(idOrName)
      ? await this.repo.findOne({
          where: [{ id: idOrName }, { name: idOrName }],
          relations: { ca: true },
        })
      : await this.repo.findOne({ where: { name: idOrName }, relations: { ca: true } });
    if (!row) {
      throw new NotFoundException(`未找到该服务器证书。`);
    }
    return this.hydrateCa(row);
  }

  async count(): Promise<number> {
    return this.repo.count();
  }

  async listSerialNumbers(): Promise<string[]> {
    const rows = await this.repo.find({ select: ['serialNumber'] });
    return rows.map((row) => row.serialNumber);
  }

  private async hydrateCa(row: IssuedCertificateEntity): Promise<IssuedCertificateEntity> {
    if (row.ca) {
      return row;
    }
    const ca = await this.caService.findRecord(row.caId);
    row.ca = ca;
    return row;
  }

  private toSummary(row: IssuedCertificateEntity): CertificateSummary {
    const caStatus = row.ca?.status ?? 'active';
    const status = computeCertificateStatus({
      caStatus,
      notBefore: row.notBefore,
      notAfter: row.notAfter,
    });
    return {
      id: row.id,
      name: row.name,
      commonName: row.commonName,
      ips: row.ips,
      dnsNames: row.dnsNames,
      sanDisplay: row.sanDisplay,
      days: row.days,
      notBefore: row.notBefore.toISOString(),
      notAfter: row.notAfter.toISOString(),
      serialNumber: row.serialNumber,
      fingerprintSha256: row.fingerprintSha256,
      publicFileName: row.publicFileName,
      keyFileName: row.keyFileName,
      publicKeyBits: row.publicKeyBits,
      createdAt: row.createdAt.toISOString(),
      ca: {
        id: row.ca?.id ?? row.caId,
        name: row.ca?.name ?? '',
        commonName: row.ca?.commonName ?? '',
        status: caStatus,
        publicFileName: row.ca?.publicFileName ?? '',
      },
      status,
      statusLabel: certificateStatusLabel(status),
      archive: {
        storageKind: 'archive',
        storageLabel: '证书库',
        uploaded: Boolean(row.archiveUploadedAt && row.archiveCertObjectKey && row.archiveKeyObjectKey),
        objectPrefix: row.archiveObjectPrefix,
        certObjectKey: row.archiveCertObjectKey,
        keyObjectKey: row.archiveKeyObjectKey,
        uploadedAt: row.archiveUploadedAt ? row.archiveUploadedAt.toISOString() : null,
      },
    };
  }

  private resolveRecordName(requested: string | undefined, commonName: string, firstIp?: string): string {
    const source = requested?.trim() || commonName || firstIp || 'server';
    const stem = sanitizePublicBasename(source);
    if (!stem) {
      throw new BadRequestException('证书名称无效，请使用不含路径的名称。');
    }
    if (stem.length > 64) {
      return stem.slice(0, 64).replace(/-+$/g, '') || 'server';
    }
    return stem;
  }

  private bundleFileName(row: IssuedCertificateEntity, requested?: string): string {
    if (requested?.trim()) {
      const stem = sanitizePublicBasename(requested.replace(/\.zip$/i, ''));
      return `${stem || row.name}-nginx.zip`;
    }
    const stem = sanitizePublicBasename(row.publicFileName.replace(/\.(crt|cer|pem)$/i, '')) || row.name;
    return `${stem}-nginx.zip`;
  }
}
