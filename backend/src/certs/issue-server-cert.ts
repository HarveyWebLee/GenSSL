import * as forge from 'node-forge';
import {
  assertSanMatches,
  buildSanAltNames,
  formatSubjectAltNameDisplay,
  normalizeSan,
  readSanFromCert,
  type NormalizedSan,
} from './san';
import type { CaHashAlgorithm } from '../ca/dto/create-ca.dto';
import type { CaSubjectInfo } from '../ca/ca.types';

export const SERVER_CERT_DEFAULTS = {
  keySize: 2048 as const,
  days: 397,
  hashAlgorithm: 'sha256' as CaHashAlgorithm,
};

export interface IssueServerCertInput {
  caCert: forge.pki.Certificate;
  caKey: forge.pki.rsa.PrivateKey;
  keys: forge.pki.rsa.KeyPair;
  ips: string[];
  dnsNames?: string[];
  subject?: CaSubjectInfo;
  days?: number;
  notBefore?: Date;
  serialNumber: string;
  hashAlgorithm?: CaHashAlgorithm;
}

export interface IssuedServerCert {
  cert: forge.pki.Certificate;
  certPem: string;
  keyPem: string;
  san: NormalizedSan;
  sanDisplay: string;
  notBefore: Date;
  notAfter: Date;
}

export interface CertVerification {
  ok: boolean;
  chainValid: boolean;
  signatureValid: boolean;
  sanValid: boolean;
  periodValid: boolean;
  keyMatch: boolean;
  basicConstraintsValid: boolean;
  extKeyUsageValid: boolean;
  messages: string[];
  sanDisplay: string;
  ips: string[];
  dnsNames: string[];
}

const ATTR_FIELDS: Array<[keyof CaSubjectInfo, string]> = [
  ['country', 'countryName'],
  ['stateOrProvince', 'stateOrProvinceName'],
  ['locality', 'localityName'],
  ['organization', 'organizationName'],
  ['organizationalUnit', 'organizationalUnitName'],
  ['commonName', 'commonName'],
  ['emailAddress', 'emailAddress'],
];

export function issueServerCertificate(input: IssueServerCertInput): IssuedServerCert {
  const san = normalizeSan({ ips: input.ips, dnsNames: input.dnsNames });
  const days = input.days ?? SERVER_CERT_DEFAULTS.days;
  const notBefore = input.notBefore ?? new Date();
  const notAfter = new Date(notBefore.getTime() + days * 24 * 60 * 60 * 1000);

  const cert = forge.pki.createCertificate();
  cert.publicKey = input.keys.publicKey;
  cert.serialNumber = input.serialNumber;
  cert.validity.notBefore = notBefore;
  cert.validity.notAfter = notAfter;

  const commonName =
    input.subject?.commonName?.trim() || san.ips[0] || 'localhost';
  const subject = { ...input.subject, commonName };
  cert.setSubject(buildSubjectAttrs(subject));
  cert.setIssuer(input.caCert.subject.attributes);

  cert.setExtensions([
    {
      name: 'basicConstraints',
      critical: true,
      cA: false,
    },
    {
      name: 'keyUsage',
      critical: true,
      digitalSignature: true,
      keyEncipherment: true,
    },
    {
      name: 'extKeyUsage',
      serverAuth: true,
    },
    {
      name: 'subjectAltName',
      altNames: buildSanAltNames(san.ips, san.dnsNames),
    },
    {
      name: 'subjectKeyIdentifier',
    },
    {
      name: 'authorityKeyIdentifier',
    },
  ]);

  cert.sign(input.caKey, createMessageDigest(input.hashAlgorithm ?? SERVER_CERT_DEFAULTS.hashAlgorithm));

  return {
    cert,
    certPem: forge.pki.certificateToPem(cert),
    keyPem: forge.pki.privateKeyToPem(input.keys.privateKey),
    san,
    sanDisplay: formatSubjectAltNameDisplay(san.ips, san.dnsNames),
    notBefore,
    notAfter,
  };
}

export function verifyServerCertificate(options: {
  cert: forge.pki.Certificate;
  caCert: forge.pki.Certificate;
  privateKey?: forge.pki.rsa.PrivateKey;
  expectedSan?: NormalizedSan;
  now?: Date;
}): CertVerification {
  const messages: string[] = [];
  const parsedSan = readSanFromCert(options.cert);
  const expected = options.expectedSan ?? {
    ips: parsedSan.ips,
    dnsNames: parsedSan.dnsNames,
  };

  const sanCheck = assertSanMatches(parsedSan, expected);
  if (!sanCheck.ok) {
    messages.push(...sanCheck.messages);
  }

  let signatureValid = false;
  let chainValid = false;
  try {
    signatureValid = options.caCert.verify(options.cert);
    if (!signatureValid) {
      messages.push('服务器证书签名无法通过根 CA 校验。');
    }
  } catch (error) {
    messages.push(
      `服务器证书签名校验失败：${error instanceof Error ? error.message : '未知错误'}`,
    );
  }

  const issuerCn = getAttr(options.cert.issuer.attributes, 'commonName');
  const caCn = getAttr(options.caCert.subject.attributes, 'commonName');
  chainValid = signatureValid && (!issuerCn || !caCn || issuerCn === caCn);
  if (signatureValid && issuerCn && caCn && issuerCn !== caCn) {
    chainValid = false;
    messages.push('证书签发者与当前根 CA 主体不一致。');
  }

  const now = options.now ?? new Date();
  const notBefore = options.cert.validity.notBefore;
  const notAfter = options.cert.validity.notAfter;
  const periodValid = now >= notBefore && now <= notAfter;
  if (!periodValid) {
    messages.push(
      now < notBefore
        ? '证书尚未生效。'
        : '证书已过期。',
    );
  }

  let keyMatch = true;
  if (options.privateKey) {
    keyMatch = publicKeysMatch(options.cert.publicKey, options.privateKey);
    if (!keyMatch) {
      messages.push('服务器私钥与证书公钥不匹配。');
    }
  }

  const basic = options.cert.getExtension('basicConstraints') as
    | { cA?: boolean }
    | undefined;
  const basicConstraintsValid = basic?.cA !== true;
  if (!basicConstraintsValid) {
    messages.push('服务器证书的 basicConstraints 必须为 CA:FALSE。');
  }

  const eku = options.cert.getExtension('extKeyUsage') as
    | { serverAuth?: boolean }
    | undefined;
  const extKeyUsageValid = eku?.serverAuth === true;
  if (!extKeyUsageValid) {
    messages.push('服务器证书必须包含 extKeyUsage: serverAuth。');
  }

  const ok =
    signatureValid &&
    chainValid &&
    sanCheck.ok &&
    periodValid &&
    keyMatch &&
    basicConstraintsValid &&
    extKeyUsageValid;

  return {
    ok,
    chainValid,
    signatureValid,
    sanValid: sanCheck.ok,
    periodValid,
    keyMatch,
    basicConstraintsValid,
    extKeyUsageValid,
    messages,
    sanDisplay: parsedSan.display,
    ips: parsedSan.ips,
    dnsNames: parsedSan.dnsNames,
  };
}

export function generateSerialNumber(existing?: Set<string>): string {
  for (let attempt = 0; attempt < 8; attempt += 1) {
    const bytes = forge.random.getBytesSync(16);
    const buf = Buffer.from(bytes, 'binary');
    buf[0] = (buf[0] ?? 0) & 0x7f;
    if (buf.every((b) => b === 0)) {
      buf[buf.length - 1] = 1;
    }
    const serial = buf.toString('hex');
    if (!existing || !existing.has(serial)) {
      return serial;
    }
  }
  throw new Error('无法生成唯一的证书序列号，请重试。');
}

export function createMessageDigest(algorithm: CaHashAlgorithm): forge.md.MessageDigest {
  if (algorithm === 'sha384') {
    return forge.md.sha384.create();
  }
  if (algorithm === 'sha512') {
    return forge.md.sha512.create();
  }
  return forge.md.sha256.create();
}

export function generateRsaKeyPair(bits: 2048 | 4096): Promise<forge.pki.rsa.KeyPair> {
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

export function sha256Fingerprint(cert: forge.pki.Certificate): string {
  const der = forge.asn1.toDer(forge.pki.certificateToAsn1(cert)).getBytes();
  const md = forge.md.sha256.create();
  md.update(der);
  const hex = md.digest().toHex().toUpperCase();
  return hex.match(/.{2}/g)?.join(':') ?? hex;
}

export function publicKeysMatch(
  certPublicKey: forge.pki.PublicKey,
  privateKey: forge.pki.PrivateKey | forge.pki.rsa.PrivateKey,
): boolean {
  try {
    const rsaPrivate = privateKey as forge.pki.rsa.PrivateKey;
    const fromPrivate = forge.pki.rsa.setPublicKey(rsaPrivate.n, rsaPrivate.e);
    return (
      forge.pki.publicKeyToPem(certPublicKey as forge.pki.rsa.PublicKey) ===
      forge.pki.publicKeyToPem(fromPrivate)
    );
  } catch {
    return false;
  }
}

export function buildSubjectAttrs(subject: CaSubjectInfo): forge.pki.CertificateField[] {
  return ATTR_FIELDS.filter(([key]) => Boolean(subject[key]))
    .map(([key, name]) => ({ name, value: subject[key] as string }));
}

export function attrsToSubject(attrs: forge.pki.CertificateField[]): CaSubjectInfo {
  const map: Record<string, keyof CaSubjectInfo> = {
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
  const subject: CaSubjectInfo = {};
  for (const attr of attrs) {
    const rawName = attr.name || attr.shortName;
    if (!rawName) {
      continue;
    }
    const key = map[rawName];
    if (key && typeof attr.value === 'string' && attr.value) {
      subject[key] = attr.value;
    }
  }
  return subject;
}

function getAttr(attrs: forge.pki.CertificateField[], name: string): string | undefined {
  const found = attrs.find((attr) => attr.name === name || attr.shortName === name);
  return typeof found?.value === 'string' ? found.value : undefined;
}
