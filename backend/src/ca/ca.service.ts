import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  InternalServerErrorException,
  NotFoundException,
  Optional,
} from '@nestjs/common';
import { createReadStream, existsSync } from 'node:fs';
import type { ReadStream } from 'node:fs';
import {
  chmod,
  mkdir,
  readFile,
  rename,
  unlink,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import * as forge from 'node-forge';
import { CreateCaDto, type CaHashAlgorithm, type CaKeySize } from './dto/create-ca.dto';
import type { CaDetails, CaStatus, CaSubjectInfo } from './ca.types';
import {
  CA_META_FILE,
  buildContentDisposition,
  buildDefaultPublicFileName,
  contentTypeForFormat,
  resolveCreatedPublicFileName,
  resolveDownloadFileName,
} from './ca-filename';

export const CA_DATA_DIR = 'CA_DATA_DIR';

export const CA_DEFAULTS = {
  country: 'CN',
  organization: 'MyCompany',
  organizationalUnit: 'IT',
  commonName: 'MyCompany Local Root CA',
  keySize: 4096 as CaKeySize,
  days: 3650,
  hashAlgorithm: 'sha256' as CaHashAlgorithm,
};

const KEY_FILE = 'rootCA.key';
const CERT_FILE = 'rootCA.crt';

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

export interface CertificateDownload {
  stream: ReadStream;
  filename: string;
  contentType: string;
  contentDisposition: string;
}

export interface CaSigningMaterial {
  cert: forge.pki.Certificate;
  key: forge.pki.rsa.PrivateKey;
  certPem: string;
}


@Injectable()
export class CaService {
  private readonly caDir: string;

  constructor(@Optional() @Inject(CA_DATA_DIR) dataDir?: string) {
    const resolved =
      dataDir?.trim() ||
      process.env.CA_DATA_DIR?.trim() ||
      path.join(process.cwd(), 'data', 'ssl-ca', 'ca');
    this.caDir = path.resolve(resolved);
  }

  getCertPath(): string {
    return path.join(this.caDir, CERT_FILE);
  }

  getKeyPath(): string {
    return path.join(this.caDir, KEY_FILE);
  }

  getMetaPath(): string {
    return path.join(this.caDir, CA_META_FILE);
  }

  hasAnyCaFile(): boolean {
    return existsSync(this.getCertPath()) || existsSync(this.getKeyPath());
  }

  hasCertificate(): boolean {
    return existsSync(this.getCertPath());
  }


  async isReady(): Promise<boolean> {
    return this.hasCertificate() && existsSync(this.getKeyPath());
  }

  async loadSigningMaterial(): Promise<CaSigningMaterial> {
    if (!(await this.isReady())) {
      throw new NotFoundException(
        '尚未创建完整的根 CA，无法签发服务器证书。请先创建根 CA。',
      );
    }

    try {
      const certPem = await readFile(this.getCertPath(), 'utf8');
      const keyPem = await readFile(this.getKeyPath(), 'utf8');
      return {
        cert: forge.pki.certificateFromPem(certPem),
        key: forge.pki.privateKeyFromPem(keyPem) as forge.pki.rsa.PrivateKey,
        certPem,
      };
    } catch (error) {
      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new InternalServerErrorException(
        `根 CA 证书或私钥无法解析：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  async readCertificatePem(): Promise<string> {
    if (!this.hasCertificate()) {
      throw new NotFoundException('尚未创建根 CA。');
    }
    try {
      return await readFile(this.getCertPath(), 'utf8');
    } catch {
      throw new InternalServerErrorException('无法读取根证书文件，请检查文件权限后重试。');
    }
  }

  async getPublicFileName(): Promise<string> {
    return this.resolvePublicFileName();
  }

  async getStatus(): Promise<CaStatus> {
    const hasCert = this.hasCertificate();
    const hasKey = existsSync(this.getKeyPath());

    if (!hasCert && !hasKey) {
      return { exists: false };
    }

    if (!hasCert && hasKey) {
      return {
        exists: true,
        incomplete: true,
        message:
          '检测到残缺的根 CA 文件（缺少 rootCA.crt）。如需重新创建，请确认后使用覆盖选项。',
      };
    }

    return this.readDetails();
  }

  async create(dto: CreateCaDto): Promise<CaDetails> {
    if (this.hasAnyCaFile() && !dto.overwrite) {
      throw new ConflictException(
        '根 CA 已存在。如需重新创建并覆盖现有根证书与私钥，请确认后开启覆盖选项（overwrite: true）。',
      );
    }

    const country = (dto.country ?? CA_DEFAULTS.country).toUpperCase();
    const organization = dto.organization ?? CA_DEFAULTS.organization;
    const organizationalUnit = dto.organizationalUnit ?? CA_DEFAULTS.organizationalUnit;
    const commonName = dto.commonName ?? CA_DEFAULTS.commonName;
    const keySize = dto.keySize ?? CA_DEFAULTS.keySize;
    const days = dto.days ?? CA_DEFAULTS.days;
    const hashAlgorithm = dto.hashAlgorithm ?? CA_DEFAULTS.hashAlgorithm;

    const notBefore = dto.notBefore ? new Date(dto.notBefore) : new Date();
    if (Number.isNaN(notBefore.getTime())) {
      throw new BadRequestException('生效时间格式无效。');
    }
    const notAfter = new Date(notBefore.getTime() + days * 24 * 60 * 60 * 1000);

    const attrs = this.buildSubjectAttrs({
      country,
      stateOrProvince: dto.stateOrProvince,
      locality: dto.locality,
      organization,
      organizationalUnit,
      commonName,
      emailAddress: dto.emailAddress,
    });

    const publicFileName = resolveCreatedPublicFileName(dto.publicFileName, {
      commonName,
      organization,
    });

    const keys = await this.generateKeyPair(keySize);

    const cert = forge.pki.createCertificate();
    cert.publicKey = keys.publicKey;
    cert.serialNumber = this.generateSerialNumber();
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
      {
        name: 'subjectKeyIdentifier',
      },
    ]);

    cert.sign(keys.privateKey, this.createMessageDigest(hashAlgorithm));

    const keyPem = forge.pki.privateKeyToPem(keys.privateKey);
    const certPem = forge.pki.certificateToPem(cert);

    await this.writeCaFiles(keyPem, certPem, publicFileName);

    return this.toDetails(cert, publicFileName);
  }

  async openCertificateFile(options?: {
    filename?: string;
    format?: string;
  }): Promise<CertificateDownload> {
    if (!this.hasCertificate()) {
      throw new NotFoundException(
        '尚未创建根 CA，无法下载根证书。请先创建根 CA。',
      );
    }

    const storedName = await this.resolvePublicFileName();
    const { filename, format } = resolveDownloadFileName({
      storedName,
      filename: options?.filename,
      format: options?.format,
    });

    return {
      stream: createReadStream(this.getCertPath()),
      filename,
      contentType: contentTypeForFormat(format),
      contentDisposition: buildContentDisposition(filename),
    };
  }

  private async generateKeyPair(bits: CaKeySize): Promise<forge.pki.rsa.KeyPair> {
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

  private generateSerialNumber(): string {
    const bytes = forge.random.getBytesSync(16);
    const buf = Buffer.from(bytes, 'binary');
    buf[0] = (buf[0] ?? 0) & 0x7f;
    if (buf.every((b) => b === 0)) {
      buf[buf.length - 1] = 1;
    }
    return buf.toString('hex');
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

  private async readDetails(): Promise<CaDetails> {
    let pem: string;
    try {
      pem = await readFile(this.getCertPath(), 'utf8');
    } catch {
      throw new InternalServerErrorException(
        '无法读取根证书文件，请检查文件权限后重试。',
      );
    }

    try {
      const cert = forge.pki.certificateFromPem(pem);
      const subject = this.attrsToSubject(cert.subject.attributes);
      const publicFileName = await this.resolvePublicFileName(subject);
      return this.toDetails(cert, publicFileName);
    } catch (error) {
      if (
        error instanceof BadRequestException ||
        error instanceof InternalServerErrorException
      ) {
        throw error;
      }
      throw new InternalServerErrorException(
        '根证书文件已损坏或无法解析，请尝试使用覆盖选项重新创建根 CA。',
      );
    }
  }

  private toDetails(cert: forge.pki.Certificate, publicFileName: string): CaDetails {
    const basicConstraints = cert.getExtension('basicConstraints') as
      | { cA?: boolean; pathLenConstraint?: number }
      | undefined;
    const keyUsageExt = cert.getExtension('keyUsage') as
      | Record<string, unknown>
      | undefined;

    const keyUsage: string[] = [];
    if (keyUsageExt) {
      for (const name of [
        'digitalSignature',
        'nonRepudiation',
        'keyEncipherment',
        'dataEncipherment',
        'keyAgreement',
        'keyCertSign',
        'cRLSign',
        'encipherOnly',
        'decipherOnly',
      ]) {
        if (keyUsageExt[name] === true) {
          keyUsage.push(name);
        }
      }
    }

    const publicKey = cert.publicKey as forge.pki.rsa.PublicKey;
    const publicKeyBits =
      typeof publicKey.n?.bitLength === 'function' ? publicKey.n.bitLength() : 0;

    const algorithmOid = cert.siginfo?.algorithmOid;
    const oidName =
      (algorithmOid && (forge.pki.oids as Record<string, string>)[algorithmOid]) ||
      algorithmOid ||
      'unknown';
    const signatureAlgorithm = SIGNATURE_ALGORITHM_NAMES[oidName] ?? oidName;

    const pathLen =
      basicConstraints && typeof basicConstraints.pathLenConstraint === 'number'
        ? basicConstraints.pathLenConstraint
        : null;

    const subject = this.attrsToSubject(cert.subject.attributes);

    return {
      exists: true,
      subject,
      issuer: this.attrsToSubject(cert.issuer.attributes),
      notBefore: cert.validity.notBefore.toISOString(),
      notAfter: cert.validity.notAfter.toISOString(),
      serialNumber: String(cert.serialNumber).toLowerCase(),
      signatureAlgorithm,
      isCA: basicConstraints?.cA === true,
      keyUsage,
      pathLenConstraint: pathLen,
      fingerprintSha256: this.sha256Fingerprint(cert),
      publicKeyAlgorithm: 'RSA',
      publicKeyBits,
      publicFileName,
      suggestedFileName: buildDefaultPublicFileName(subject),
    };
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

  private async resolvePublicFileName(subject?: CaSubjectInfo): Promise<string> {
    const stored = await this.readStoredPublicFileName();
    if (stored) {
      return stored;
    }

    if (subject) {
      return buildDefaultPublicFileName(subject);
    }

    try {
      const pem = await readFile(this.getCertPath(), 'utf8');
      const cert = forge.pki.certificateFromPem(pem);
      return buildDefaultPublicFileName(this.attrsToSubject(cert.subject.attributes));
    } catch {
      return buildDefaultPublicFileName({});
    }
  }

  private async readStoredPublicFileName(): Promise<string | undefined> {
    if (!existsSync(this.getMetaPath())) {
      return undefined;
    }

    try {
      const raw = await readFile(this.getMetaPath(), 'utf8');
      const parsed = JSON.parse(raw) as { publicFileName?: unknown };
      if (typeof parsed.publicFileName === 'string' && parsed.publicFileName.trim()) {
        return resolveCreatedPublicFileName(parsed.publicFileName, {});
      }
    } catch {
      // 元数据缺失或损坏时回退到按证书主体自动生成
    }
    return undefined;
  }

  private async writeCaFiles(
    keyPem: string,
    certPem: string,
    publicFileName: string,
  ): Promise<void> {
    await mkdir(this.caDir, { recursive: true });

    const keyTmp = `${this.getKeyPath()}.tmp`;
    const certTmp = `${this.getCertPath()}.tmp`;
    const metaTmp = `${this.getMetaPath()}.tmp`;

    try {
      await writeFile(keyTmp, keyPem, { encoding: 'utf8', mode: 0o600 });
      await writeFile(certTmp, certPem, { encoding: 'utf8', mode: 0o644 });
      await writeFile(
        metaTmp,
        `${JSON.stringify({ publicFileName }, null, 2)}\n`,
        { encoding: 'utf8', mode: 0o644 },
      );
      await this.replaceFile(keyTmp, this.getKeyPath(), 0o600);
      await this.replaceFile(certTmp, this.getCertPath(), 0o644);
      await this.replaceFile(metaTmp, this.getMetaPath(), 0o644);
    } catch (error) {
      await this.safeUnlink(keyTmp);
      await this.safeUnlink(certTmp);
      await this.safeUnlink(metaTmp);
      throw new InternalServerErrorException(
        `写入根 CA 文件失败：${error instanceof Error ? error.message : '未知错误'}`,
      );
    }
  }

  private async replaceFile(tmpPath: string, destPath: string, mode: number): Promise<void> {
    if (existsSync(destPath)) {
      await unlink(destPath);
    }
    await rename(tmpPath, destPath);
    try {
      await chmod(destPath, mode);
    } catch {
      // Windows 等环境可能不支持 chmod，忽略即可
    }
  }

  private async safeUnlink(filePath: string): Promise<void> {
    try {
      if (existsSync(filePath)) {
        await unlink(filePath);
      }
    } catch {
      // ignore cleanup errors
    }
  }
}
