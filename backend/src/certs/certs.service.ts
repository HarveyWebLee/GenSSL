import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createReadStream, existsSync } from 'node:fs';
import type { ReadStream } from 'node:fs';
import { mkdir, readFile, rm, writeFile, chmod } from 'node:fs/promises';
import path from 'node:path';
import { PassThrough } from 'node:stream';
import archiver from 'archiver';
import * as forge from 'node-forge';
import { Repository } from 'typeorm';
import { CaService } from '../ca/ca.service';
import {
  buildContentDisposition,
  contentTypeForFormat,
  sanitizePublicBasename,
} from '../ca/ca-filename';
import { IssueCertDto } from './dto/issue-cert.dto';
import { IssuedCertificateEntity } from './issued-certificate.entity';
import {
  deriveServerKeyFileName,
  resolveServerCertDownloadName,
  resolveServerCertPublicFileName,
  resolveServerKeyDownloadName,
} from './cert-filename';
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

export const CERTS_DATA_DIR = 'CERTS_DATA_DIR';

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
  filesPresent: boolean;
}

export interface CertificateDetail extends CertificateSummary {
  subject: Record<string, string>;
  issuer: Record<string, string>;
  signatureAlgorithm: string;
  isCA: boolean;
  verification: CertVerification;
}

export interface FileDownload {
  stream: ReadStream | PassThrough;
  filename: string;
  contentType: string;
  contentDisposition: string;
  warning?: string;
}

@Injectable()
export class CertsService {
  private readonly certsDir: string;

  constructor(
    private readonly caService: CaService,
    @InjectRepository(IssuedCertificateEntity)
    private readonly repo: Repository<IssuedCertificateEntity>,
    @Optional() @Inject(CERTS_DATA_DIR) dataDir?: string,
  ) {
    const resolved =
      dataDir?.trim() ||
      process.env.CERTS_DATA_DIR?.trim() ||
      path.join(process.cwd(), 'data', 'ssl-ca', 'certs');
    this.certsDir = path.resolve(resolved);
  }

  getCertDir(name: string): string {
    return path.join(this.certsDir, name);
  }

  getCertPath(name: string): string {
    return path.join(this.getCertDir(name), 'server.crt');
  }

  getKeyPath(name: string): string {
    return path.join(this.getCertDir(name), 'server.key');
  }

  async list(): Promise<{ items: CertificateSummary[] }> {
    const rows = await this.repo.find({ order: { createdAt: 'DESC' } });
    return {
      items: rows.map((row) => this.toSummary(row)),
    };
  }

  async issue(dto: IssueCertDto): Promise<CertificateDetail> {
    const ca = await this.caService.loadSigningMaterial();
    const san = normalizeSan({ ips: dto.ips, dnsNames: dto.dnsNames });
    const caSubject = attrsToSubject(ca.cert.subject.attributes);

    const commonName = (dto.commonName?.trim() || san.ips[0]) as string;
    const name = this.resolveRecordName(dto.name, commonName, san.ips[0]);

    const existing = await this.repo.findOne({ where: { name } });
    if ((existing || existsSync(this.getCertDir(name))) && !dto.overwrite) {
      throw new ConflictException(
        `名为「${name}」的服务器证书已存在。如需覆盖，请确认后开启覆盖选项。覆盖不会删除根 CA，但会使该名称下旧的服务器证书失效。`,
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
    const existingSerials = new Set(
      (await this.repo.find({ select: ['serialNumber'] })).map((row) => row.serialNumber),
    );
    if (existing) {
      existingSerials.delete(existing.serialNumber);
    }

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

    await this.writeCertFiles(name, issued.certPem, issued.keyPem);

    const row = existing ?? this.repo.create({ name });
    row.commonName = commonName;
    row.ips = san.ips;
    row.dnsNames = san.dnsNames;
    row.days = days;
    row.notBefore = issued.notBefore;
    row.notAfter = issued.notAfter;
    row.serialNumber = String(issued.cert.serialNumber).toLowerCase();
    row.fingerprintSha256 = sha256Fingerprint(issued.cert);
    row.signatureAlgorithm = 'sha256WithRSAEncryption';
    if (dto.hashAlgorithm === 'sha384') {
      row.signatureAlgorithm = 'sha384WithRSAEncryption';
    } else if (dto.hashAlgorithm === 'sha512') {
      row.signatureAlgorithm = 'sha512WithRSAEncryption';
    }
    row.publicKeyBits = keySize;
    row.subject = attrsToSubject(issued.cert.subject.attributes) as Record<string, string>;
    row.publicFileName = publicFileName;
    row.keyFileName = keyFileName;
    row.sanDisplay = issued.sanDisplay;
    await this.repo.save(row);

    return this.getDetail(name);
  }

  async getDetail(nameOrId: string): Promise<CertificateDetail> {
    const row = await this.findRecord(nameOrId);
    const ca = await this.caService.loadSigningMaterial();
    const { cert, key } = await this.readLocalMaterial(row.name);
    const expected: NormalizedSan = { ips: row.ips, dnsNames: row.dnsNames };
    const verification = verifyServerCertificate({
      cert,
      caCert: ca.cert,
      privateKey: key,
      expectedSan: expected,
    });

    return {
      ...this.toSummary(row),
      subject: row.subject,
      issuer: attrsToSubject(ca.cert.subject.attributes) as Record<string, string>,
      signatureAlgorithm: row.signatureAlgorithm,
      isCA: false,
      verification,
    };
  }

  async openDownload(
    nameOrId: string,
    options?: { part?: 'bundle' | 'cert' | 'key'; filename?: string; format?: string },
  ): Promise<FileDownload> {
    const row = await this.findRecord(nameOrId);
    await this.assertFilesPresent(row.name);
    const part = options?.part ?? 'bundle';

    if (part === 'cert') {
      const { filename, format } = resolveServerCertDownloadName({
        storedName: row.publicFileName,
        filename: options?.filename,
        format: options?.format,
      });
      return {
        stream: createReadStream(this.getCertPath(row.name)),
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
      return {
        stream: createReadStream(this.getKeyPath(row.name)),
        filename,
        contentType: 'application/x-pem-file',
        contentDisposition: buildContentDisposition(filename),
        warning:
          '此文件是服务器私钥，只用于部署到对应 Nginx 服务器，不要分发给客户端，也不要与 rootCA.key 混淆。',
      };
    }

    const zipName = this.bundleFileName(row, options?.filename);
    const archive = archiver('zip', { zlib: { level: 9 } });
    const passthrough = new PassThrough();
    archive.on('error', (error) => {
      passthrough.destroy(error);
    });
    archive.pipe(passthrough);
    archive.file(this.getCertPath(row.name), { name: row.publicFileName });
    archive.file(this.getKeyPath(row.name), { name: row.keyFileName });
    void archive.finalize();

    return {
      stream: passthrough,
      filename: zipName,
      contentType: 'application/zip',
      contentDisposition: buildContentDisposition(zipName),
      warning:
        '压缩包中包含服务器证书与服务器私钥（server.key），只用于部署到对应 Nginx，不要分发给客户端。压缩包绝不包含 rootCA.key。',
    };
  }

  async readLocalMaterial(name: string): Promise<{
    cert: forge.pki.Certificate;
    key: forge.pki.rsa.PrivateKey;
    certPem: string;
    keyPem: string;
  }> {
    await this.assertFilesPresent(name);
    const certPem = await readFile(this.getCertPath(name), 'utf8');
    const keyPem = await readFile(this.getKeyPath(name), 'utf8');
    return {
      cert: forge.pki.certificateFromPem(certPem),
      key: forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey,
      certPem,
      keyPem,
    };
  }

  async findRecord(nameOrId: string): Promise<IssuedCertificateEntity> {
    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    const row = uuidRe.test(nameOrId)
      ? await this.repo.findOne({ where: [{ id: nameOrId }, { name: nameOrId }] })
      : await this.repo.findOne({ where: { name: nameOrId } });
    if (!row) {
      throw new NotFoundException(`未找到名为「${nameOrId}」的服务器证书。`);
    }
    return row;
  }

  async count(): Promise<number> {
    return this.repo.count();
  }

  private toSummary(row: IssuedCertificateEntity): CertificateSummary {
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
      filesPresent: existsSync(this.getCertPath(row.name)) && existsSync(this.getKeyPath(row.name)),
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

  private async writeCertFiles(name: string, certPem: string, keyPem: string): Promise<void> {
    const dir = this.getCertDir(name);
    await mkdir(dir, { recursive: true });
    const certPath = this.getCertPath(name);
    const keyPath = this.getKeyPath(name);
    try {
      await writeFile(certPath, certPem, { encoding: 'utf8', mode: 0o644 });
      await writeFile(keyPath, keyPem, { encoding: 'utf8', mode: 0o600 });
      try {
        await chmod(keyPath, 0o600);
      } catch {
        // Windows may ignore chmod
      }
    } catch (error) {
      throw new InternalServerErrorException(
        `写入服务器证书文件失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  private async assertFilesPresent(name: string): Promise<void> {
    if (!existsSync(this.getCertPath(name)) || !existsSync(this.getKeyPath(name))) {
      throw new NotFoundException(
        `证书「${name}」的本地文件缺失（需要 server.crt 与 server.key）。请重新签发。`,
      );
    }
  }

  async removeLocalDir(name: string): Promise<void> {
    await rm(this.getCertDir(name), { recursive: true, force: true });
  }
}
