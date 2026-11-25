export type CaKeySize = 2048 | 4096 | 8192;
export type CaHashAlgorithm = 'sha256' | 'sha384' | 'sha512';
export type CaCertFormat = 'crt' | 'cer' | 'pem';

export interface CaSubjectInfo {
  country?: string;
  stateOrProvince?: string;
  locality?: string;
  organization?: string;
  organizationalUnit?: string;
  commonName?: string;
  emailAddress?: string;
}

export interface CreateCaPayload {
  country?: string;
  stateOrProvince?: string;
  locality?: string;
  organization?: string;
  organizationalUnit?: string;
  commonName?: string;
  emailAddress?: string;
  keySize?: CaKeySize;
  days?: number;
  notBefore?: string;
  hashAlgorithm?: CaHashAlgorithm;
  pathLenConstraint?: number;
  publicFileName?: string;
  overwrite?: boolean;
}

export interface CaDetails {
  exists: true;
  incomplete?: false;
  subject: CaSubjectInfo;
  issuer: CaSubjectInfo;
  notBefore: string;
  notAfter: string;
  serialNumber: string;
  signatureAlgorithm: string;
  isCA: boolean;
  keyUsage: string[];
  pathLenConstraint: number | null;
  fingerprintSha256: string;
  publicKeyAlgorithm: string;
  publicKeyBits: number;
  publicFileName: string;
  suggestedFileName: string;
}

export interface CaIncomplete {
  exists: true;
  incomplete: true;
  message: string;
}

export interface CaAbsent {
  exists: false;
}

export type CaStatus = CaDetails | CaIncomplete | CaAbsent;

export function isCaDetails(status: CaStatus): status is CaDetails {
  return status.exists === true && status.incomplete !== true;
}

export interface GenerateNginxPayload {
  serverName?: string;
  listenPort?: number;
  rootPath?: string;
  proxyPass?: string;
  sslCertificate?: string;
  sslCertificateKey?: string;
}

export interface IssueCertPayload {
  name?: string;
  ips: string[];
  dnsNames?: string[];
  country?: string;
  stateOrProvince?: string;
  locality?: string;
  organization?: string;
  organizationalUnit?: string;
  commonName?: string;
  days?: number;
  keySize?: 2048 | 4096;
  hashAlgorithm?: CaHashAlgorithm;
  publicFileName?: string;
  overwrite?: boolean;
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

export interface ServerPath {
  id: string;
  path: string;
  label: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerRecord {
  id: string;
  name: string;
  host: string | null;
  description: string | null;
  paths: ServerPath[];
  createdAt: string;
  updatedAt: string;
}

export interface DeployedFile {
  kind: 'server-cert' | 'server-key' | 'ca-cert';
  fileName: string;
  objectKey: string;
  size: number;
}

export interface DeployRecord {
  id: string;
  certificate: { id: string; name?: string; commonName?: string; publicFileName?: string; keyFileName?: string };
  server: { id: string; name?: string; host?: string | null };
  path: { id: string; path?: string; label?: string | null };
  objectPrefix: string;
  files: DeployedFile[];
  overwritten: boolean;
  createdAt: string;
  warning?: string;
}

export interface TargetFileList {
  server: { id: string; name: string; host: string | null };
  path: { id: string; path: string; label: string | null };
  prefix: string;
  files: Array<{
    key: string;
    size: number;
    lastModified?: string;
    fileName: string;
    kind: 'server-cert' | 'server-key' | 'ca-cert' | 'unknown';
  }>;
  latestDeploy: DeployRecord | null;
}

export interface OverviewData {
  ca: {
    exists: boolean;
    ready: boolean;
    incomplete: boolean;
    commonName?: string;
    notBefore?: string;
    notAfter?: string;
    publicFileName?: string;
  };
  certificateCount: number;
  serverCount: number;
  storage: {
    ready: boolean;
    endpoint?: string;
    bucket?: string;
    lastError?: string | null;
  };
}
