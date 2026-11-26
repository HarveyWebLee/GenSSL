import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import * as forge from 'node-forge';
import { Repository } from 'typeorm';
import {
  buildContentDisposition,
  buildDefaultPublicFileName,
  contentTypeForFormat,
  resolveCreatedPublicFileName,
  resolveDownloadFileName,
} from './ca-filename';
import type { CaHashAlgorithm, CreateCaDto } from './dto/create-ca.dto';
import { IssuedCertificateEntity } from '../certs/issued-certificate.entity';
import { computeCertificateStatus } from '../certs/cert-status';
import { RootCaEntity } from './root-ca.entity';
import type { CaSigningMaterial, CaSubjectInfo, RootCaSummary } from './ca.types';

export const CA_DEFAULTS = {
  country: 'CN',
  keySize: 4096 as const,
  days: 3650,
  hashAlgorithm: 'sha256' as CaHashAlgorithm,
};

const ATTR_NAME_MAP: Record<string, keyof CaSubjectInfo> = {
  countryName: 'country',
  C: 'country',
  stateOrProvinceName: 'stateOrProvince',
  ST: 'stateOrProvince',
  localityName: 'locality',
  L: 'locality',
  organizationName: 'organization',
  O: 'organization',
  organizationalUnitName: 'organizationalUnit',
  OU: 'organizationalUnit',
  commonName: 'commonName',
  CN: 'commonName',
  emailAddress: 'emailAddress',
  E: 'emailAddress',
};

const SIGNATURE_ALGORITHM_NAMES: Record<string, string> = {
  sha256WithRSAEncryption: 'sha256WithRSAEncryption',
  sha384WithRSAEncryption: 'sha384WithRSAEncryption',
  sha512WithRSAEncryption: 'sha512WithRSAEncryption',
};

const KEY_USAGE_FLAGS = [
  'digitalSignature',
  'nonRepudiation',
  'keyEncipherment',
  'dataEncipherment',
  'keyAgreement',
  'keyCertSign',
  'cRLSign',
  'encipherOnly',
  'decipherOnly',
];

export interface CertificateDownload {
  stream: Readable;
  filename: string;
  contentType: string;
  contentDisposition: string;
}

@Injectable()
export class CaService {
  constructor(
    @InjectRepository(RootCaEntity)
    private readonly repo: Repository<RootCaEntity>,
    @InjectRepository(IssuedCertificateEntity)
    private readonly certRepo: Repository<IssuedCertificateEntity>,
  ) {}

  async list(): Promise<{ items: RootCaSummary[]; activeCount: number; retiredCount: number }> {
    const rows = await this.repo.find({ order: { createdAt: 'DESC' } });
    const certs = await this.certRepo.find();
    const items = rows.map((row) => this.toSummary(row, certs.filter((cert) => cert.caId === row.id)));
    return {
      items,
      activeCount: items.filter((item) => item.status === 'active').length,
      retiredCount: items.filter((item) => item.status === 'retired').length,
    };
  }

  async get(id: string): Promise<RootCaSummary> {
    const row = await this.findRecord(id);
    const certs = await this.certRepo.find({ where: { caId: row.id } });
    return this.toSummary(row, certs);
  }

  async create(dto: CreateCaDto): Promise<RootCaSummary> {
    const name = dto.name.trim();
    if (!name) {
      throw new BadRequestException('请填写根证书名称。');
    }
    const existing = await this.repo.findOne({ where: { name } });
    if (existing) {
      throw new ConflictException(`根证书「${name}」已存在。如需轮换，请另建一棵新的根证书，不要覆盖旧根。`);
    }

    const country = (dto.country ?? CA_DEFAULTS.country).toUpperCase();
    const commonName = dto.commonName?.trim() || name;
    const keySize = dto.keySize ?? CA_DEFAULTS.keySize;
    const days = dto.days ?? CA_DEFAULTS.days;
    const hashAlgorithm = dto.hashAlgorithm ?? CA_DEFAULTS.hashAlgorithm;

    const notBefore = dto.notBefore ? new Date(dto.notBefore) : new Date();
    if (Number.isNaN(notBefore.getTime())) {
      throw new BadRequestException('生效时间格式无效。');
    }
    const notAfter = new Date(notBefore.getTime() + days * 24 * 60 * 60 * 1000);

    const subject: CaSubjectInfo = {
      country,
      stateOrProvince: dto.stateOrProvince,
      locality: dto.locality,
      organization: dto.organization,
      organizationalUnit: dto.organizationalUnit,
      commonName,
      emailAddress: dto.emailAddress,
    };
    const attrs = this.buildSubjectAttrs(subject);
    const publicFileName = resolveCreatedPublicFileName(dto.publicFileName, {
      commonName,
      organization: dto.organization,
    });

    const keys = await this.generateKeyPair(keySize);
    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = await this.generateUniqueSerialNumber();
    cert.validity.notBefore = notBefore;
    cert.validity.notAfter = notAfter;
    cert.setSubject(attrs);
    cert.setIssuer(attrs);

    const basicConstraints: Record<string, unknown> = {
      name: 'basicConstraints',
      critical: true,
      cA: true,
    };
    if (dto.pathLenConstraint !== undefined) {
      basicConstraints.pathLenConstraint = dto.pathLenConstraint;
    }
    cert.setExtensions([
      basicConstraints,
      {
        name: 'keyUsage',
        critical: true,
        keyCertSign: true,
        cRLSign: true,
      },
      { name: 'subjectKeyIdentifier' },
    ]);
    cert.sign(keys.privateKey, this.createMessageDigest(hashAlgorithm));

    const details = this.inspectCertificate(cert, publicFileName);
    const row = this.repo.create({
      id: randomUUID(),
      name,
      commonName,
      subject: details.subject as Record<string, string>,
      issuer: details.issuer as Record<string, string>,
      notBefore: cert.validity.notBefore,
      notAfter: cert.validity.notAfter,
      serialNumber: details.serialNumber,
      fingerprintSha256: details.fingerprintSha256,
      signatureAlgorithm: details.signatureAlgorithm,
      publicKeyAlgorithm: 'RSA',
      publicKeyBits: details.publicKeyBits,
      keyUsage: details.keyUsage,
      pathLenConstraint: details.pathLenConstraint,
      publicFileName,
      status: 'active',
      retiredAt: null,
      privateKeyPem: forge.pki.privateKeyToPem(keys.privateKey),
      certificatePem: forge.pki.certificateToPem(cert),
      archiveObjectKey: null,
      archiveUploadedAt: null,
    });
    await this.repo.save(row);
    return this.toSummary(row, []);
  }

  async retire(id: string): Promise<RootCaSummary> {
    const row = await this.findRecord(id);
    if (row.status === 'retired') {
      return this.get(id);
    }
    row.status = 'retired';
    row.retiredAt = new Date();
    await this.repo.save(row);
    return this.get(id);
  }

  async loadSigningMaterial(caId: string): Promise<CaSigningMaterial & { cert: forge.pki.Certificate; key: forge.pki.rsa.PrivateKey }> {
    const row = await this.findRecord(caId, { withPrivateKey: true });
    if (row.status === 'retired') {
      throw new BadRequestException(
        `根证书「${row.name}」已停用，不能再签发新的服务器证书。请改用一棵启用中的根证书。`,
      );
    }
    if (!row.privateKeyPem || !row.certificatePem) {
      throw new InternalServerErrorException('根证书材料不完整，无法签发。');
    }
    try {
      return {
        id: row.id,
        name: row.name,
        certPem: row.certificatePem,
        keyPem: row.privateKeyPem,
        publicFileName: row.publicFileName,
        status: row.status,
        cert: forge.pki.certificateFromPem(row.certificatePem),
        key: forge.pki.privateKeyFromPem(row.privateKeyPem) as forge.pki.rsa.PrivateKey,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `根 CA 证书或私钥无法解析：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  async loadPublicMaterial(caId: string): Promise<{ row: RootCaEntity; cert: forge.pki.Certificate; certPem: string }> {
    const row = await this.findRecord(caId);
    try {
      return {
        row,
        cert: forge.pki.certificateFromPem(row.certificatePem),
        certPem: row.certificatePem,
      };
    } catch (error) {
      throw new InternalServerErrorException(
        `根证书无法解析：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  async openCertificateFile(
    id: string,
    options?: { filename?: string; format?: string },
  ): Promise<CertificateDownload> {
    const row = await this.findRecord(id);
    const { filename, format } = resolveDownloadFileName({
      storedName: row.publicFileName,
      filename: options?.filename,
      format: options?.format,
    });
    const pem = row.certificatePem;
    if (pem.includes('PRIVATE KEY')) {
      throw new InternalServerErrorException('根证书数据异常，已拒绝下载。');
    }
    return {
      stream: Readable.from(Buffer.from(pem, 'utf8')),
      filename,
      contentType: contentTypeForFormat(format),
      contentDisposition: buildContentDisposition(filename),
    };
  }

  async markArchived(id: string, objectKey: string): Promise<RootCaSummary> {
    const row = await this.findRecord(id);
    row.archiveObjectKey = objectKey;
    row.archiveUploadedAt = new Date();
    await this.repo.save(row);
    return this.get(id);
  }

  async countActive(): Promise<number> {
    return this.repo.count({ where: { status: 'active' } });
  }

  async countAll(): Promise<number> {
    return this.repo.count();
  }

  async findRecord(id: string, options?: { withPrivateKey?: boolean }): Promise<RootCaEntity> {
    const row = options?.withPrivateKey
      ? await this.repo
          .createQueryBuilder('ca')
          .addSelect('ca.privateKeyPem')
          .where('ca.id = :id', { id })
          .getOne()
      : await this.repo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('未找到该根证书。');
    }
    return row;
  }

  assertDtoHasNoPrivateKey(payload: object): void {
    const serialized = JSON.stringify(payload);
    if (serialized.includes('PRIVATE KEY') || serialized.includes('privateKeyPem')) {
      throw new InternalServerErrorException('响应中不得包含根 CA 私钥。');
    }
  }

  private toSummary(row: RootCaEntity, certs: IssuedCertificateEntity[]): RootCaSummary {
    const statuses = certs.map((cert) =>
      computeCertificateStatus({
        caStatus: row.status,
        notBefore: cert.notBefore,
        notAfter: cert.notAfter,
      }),
    );
    const summary: RootCaSummary = {
      id: row.id,
      name: row.name,
      commonName: row.commonName,
      subject: row.subject,
      issuer: row.issuer,
      notBefore: row.notBefore.toISOString(),
      notAfter: row.notAfter.toISOString(),
      serialNumber: row.serialNumber,
      signatureAlgorithm: row.signatureAlgorithm,
      isCA: true,
      keyUsage: row.keyUsage,
      pathLenConstraint: row.pathLenConstraint,
      fingerprintSha256: row.fingerprintSha256,
      publicKeyAlgorithm: row.publicKeyAlgorithm,
      publicKeyBits: row.publicKeyBits,
      publicFileName: row.publicFileName,
      suggestedFileName: buildDefaultPublicFileName(row.subject),
      status: row.status,
      retiredAt: row.retiredAt ? row.retiredAt.toISOString() : null,
      certificateCount: certs.length,
      validCertificateCount: statuses.filter((status) => status === 'valid').length,
      needsReissueCount: statuses.filter((status) => status === 'needs_reissue').length,
      archive: {
        storageKind: 'archive',
        storageLabel: '证书库',
        uploaded: Boolean(row.archiveUploadedAt && row.archiveObjectKey),
        objectKey: row.archiveObjectKey,
        uploadedAt: row.archiveUploadedAt ? row.archiveUploadedAt.toISOString() : null,
      },
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
    this.assertDtoHasNoPrivateKey(summary);
    return summary;
  }

  private inspectCertificate(cert: forge.pki.Certificate, publicFileName: string) {
    const basicConstraints = cert.getExtension('basicConstraints') as
      | { cA?: boolean; pathLenConstraint?: number }
      | undefined;
    const keyUsageExt = cert.getExtension('keyUsage') as Record<string, unknown> | undefined;
    const keyUsage: string[] = [];
    if (keyUsageExt) {
      for (const name of KEY_USAGE_FLAGS) {
        if (keyUsageExt[name] === true) {
          keyUsage.push(name);
        }
      }
    }
    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    const publicKeyBits = typeof publicKey.n?.bitLength === 'function' ? publicKey.n.bitLength() : 0;
    const algorithmOid = cert.siginfo?.algorithmOid;
    const oidName =
      (algorithmOid && (forge.pki.oids as Record<string, string>)[algorithmOid]) || algorithmOid || 'unknown';
    return {
      subject: this.attrsToSubject(cert.subject.attributes),
      issuer: this.attrsToSubject(cert.issuer.attributes),
      serialNumber: String(cert.serialNumber).toLowerCase(),
      signatureAlgorithm: SIGNATURE_ALGORITHM_NAMES[oidName] ?? oidName,
      keyUsage,
      pathLenConstraint:
        basicConstraints && typeof basicConstraints.pathLenConstraint === 'number'
          ? basicConstraints.pathLenConstraint
          : null,
      fingerprintSha256: this.sha256Fingerprint(cert),
      publicKeyBits,
      publicFileName,
      isCA: basicConstraints?.cA === true,
    };
  }

  private async generateUniqueSerialNumber(): Promise<string> {
    const existing = new Set((await this.repo.find({ select: ['serialNumber'] as never })).map((row) => row.serialNumber));
    const certSerials = await this.certRepo.find({ select: ['serialNumber'] });
    for (const row of certSerials) {
      existing.add(row.serialNumber);
    }
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const serial = this.generateSerialNumber();
      if (!existing.has(serial)) {
        return serial;
      }
    }
    throw new InternalServerErrorException('无法生成唯一的证书序列号，请重试。');
  }

  private generateSerialNumber(): string {
    const bytes = forge.random.getBytesSync(16);
    const buf = Buffer.from(bytes, 'binary');
    buf[0] = (buf[0] ?? 0) & 0x7f;
    if (buf.every((b) => b === 0)) {
      buf[buf.length - 1] = 1;
    }
    return buf.toString('hex');
  }

  private generateKeyPair(bits: 2048 | 4096 | 8192): Promise<forge.pki.rsa.KeyPair> {
    return new Promise((resolve, reject) => {
      forge.pki.rsa.generateKeyPair({ bits }, (err, keypair) => {
        if (err) {
          reject(err);
          return;
        }
        resolve(keypair);
      });
    });
  }

  private createMessageDigest(algorithm: CaHashAlgorithm): forge.md.MessageDigest {
    if (algorithm === 'sha384') {
      return forge.md.sha384.create();
    }
    if (algorithm === 'sha512') {
      return forge.md.sha512.create();
    }
    return forge.md.sha256.create();
  }

  private buildSubjectAttrs(subject: CaSubjectInfo): forge.pki.CertificateField[] {
    const fields: Array<[keyof CaSubjectInfo, string, string | undefined]> = [
      ['country', 'countryName', subject.country],
      ['stateOrProvince', 'stateOrProvinceName', subject.stateOrProvince],
      ['locality', 'localityName', subject.locality],
      ['organization', 'organizationName', subject.organization],
      ['organizationalUnit', 'organizationalUnitName', subject.organizationalUnit],
      ['commonName', 'commonName', subject.commonName],
      ['emailAddress', 'emailAddress', subject.emailAddress],
    ];
    return fields
      .filter((entry): entry is [keyof CaSubjectInfo, string, string] => Boolean(entry[2]))
      .map(([, name, value]) => ({ name, value }));
  }

  private attrsToSubject(attrs: forge.pki.CertificateField[]): CaSubjectInfo {
    const subject: CaSubjectInfo = {};
    for (const attr of attrs) {
      const rawName = attr.name || attr.shortName;
      if (!rawName) {
        continue;
      }
      const key = ATTR_NAME_MAP[rawName];
      if (key && typeof attr.value === 'string' && attr.value) {
        subject[key] = attr.value;
      }
    }
    return subject;
  }

  private sha256Fingerprint(cert: forge.pki.Certificate): string {
    const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
    const md = forge.md.sha256.create();
    md.update(der);
    const hex = md.digest().toHex().toUpperCase();
    return hex.match(/.{2}/g)?.join(':') ?? hex;
  }
}
