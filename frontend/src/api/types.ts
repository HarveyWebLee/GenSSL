export type CaKeySize = 2048 | 4096 | 8192;
export type CaHashAlgorithm = 'sha256' | 'sha384' | 'sha512';
export type CaCertFormat = 'crt' | 'cer' | 'pem';
export type RootCaLifecycleStatus = 'active' | 'retired';
export type CertificateLifecycleStatus = 'valid' | 'expired' | 'not_yet_valid' | 'needs_reissue';

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
  name: string;
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
}

export interface ArchiveStatus {
  storageKind: 'archive';
  storageLabel: '证书库';
  uploaded: boolean;
  objectKey?: string | null;
  objectPrefix?: string | null;
  certObjectKey?: string | null;
  keyObjectKey?: string | null;
  uploadedAt: string | null;
}

export interface RootCaSummary {
  id: string;
  name: string;
  commonName: string;
  subject: CaSubjectInfo;
  issuer: CaSubjectInfo;
  notBefore: string;
  notAfter: string;
  serialNumber: string;
  signatureAlgorithm: string;
  isCA: true;
  keyUsage: string[];
  pathLenConstraint: number | null;
  fingerprintSha256: string;
  publicKeyAlgorithm: string;
  publicKeyBits: number;
  publicFileName: string;
  suggestedFileName: string;
  status: RootCaLifecycleStatus;
  retiredAt: string | null;
  certificateCount: number;
  validCertificateCount: number;
  needsReissueCount: number;
  archive: ArchiveStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CaListResponse {
  items: RootCaSummary[];
  activeCount: number;
  retiredCount: number;
}

export interface GenerateNginxPayload {
  serverName?: string;
  listenPort?: number;
  rootPath?: string;
  proxyPass?: string;
  sslCertificate?: string;
  sslCertificateKey?: string;
}

export interface NginxConfigResult {
  implemented: boolean;
  config: string;
  note?: string;
  cas?: Array<{ id: string; name: string; status: RootCaLifecycleStatus; publicFileName: string }>;
}

export interface IssueCertPayload {
  caId: string;
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
  archive: ArchiveStatus;
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
  storageKind: 'deploy';
  storageLabel: string;
  certificate: {
    id: string;
    name?: string;
    commonName?: string;
    publicFileName?: string;
    keyFileName?: string;
    caId?: string;
  };
  server: { id: string; name?: string; host?: string | null };
  path: { id: string; path?: string; label?: string | null };
  objectPrefix: string;
  files: DeployedFile[];
  overwritten: boolean;
  createdAt: string;
  warning?: string;
}

export interface TargetFileList {
  storageKind: 'deploy';
  storageLabel: string;
  server: { id: string; name: string; host: string | null };
  path: { id: string; path: string; label: string | null };
  prefix: string;
  files: Array<{
    key: string;
    size: number;
    lastModified?: string;
    fileName: string;
    kind: 'server-cert' | 'server-key' | 'ca-cert' | 'unknown';
    storageKind?: 'deploy';
  }>;
  latestDeploy: DeployRecord | null;
}

export interface StorageKindStats {
  storageKind: 'archive' | 'deploy';
  storageLabel: string;
  prefix: string;
  objectCount: number | null;
}

export interface OverviewData {
  cas: {
    total: number;
    active: number;
    retired: number;
    ready: boolean;
    items: Array<{
      id: string;
      name: string;
      commonName: string;
      status: RootCaLifecycleStatus;
      notAfter: string;
      publicFileName: string;
      certificateCount: number;
      validCertificateCount: number;
      needsReissueCount: number;
      archive: ArchiveStatus;
    }>;
  };
  certificateCount: number;
  validCertificateCount: number;
  needsReissueCount: number;
  expiredCertificateCount: number;
  serverCount: number;
  storage: {
    ready: boolean;
    endpoint?: string;
    bucket?: string;
    lastError?: string | null;
    archive: StorageKindStats;
    deploy: StorageKindStats;
  };
}

export interface ArchiveLibrary {
  storageKind: 'archive';
  storageLabel: string;
  prefix: string;
  storage: { ready: boolean; endpoint?: string; bucket?: string; lastError?: string | null };
  rustfsFiles: { cas: Array<{ key: string; size: number }>; certs: Array<{ key: string; size: number }> } | null;
  cas: Array<{ id: string; name: string; status: RootCaLifecycleStatus; publicFileName: string; archive: ArchiveStatus }>;
  certificates: Array<{
    id: string;
    name: string;
    ca: CertificateCaRef;
    publicFileName: string;
    keyFileName: string;
    status: CertificateLifecycleStatus;
    statusLabel: string;
    archive: ArchiveStatus;
  }>;
  note: string;
}

export interface WindowsTrustGuide {
  implemented: boolean;
  selectedCa: { id: string; name: string; status: RootCaLifecycleStatus; publicFileName: string } | null;
  cas: Array<{ id: string; name: string; status: RootCaLifecycleStatus; publicFileName: string }>;
  steps: string[];
  warning: string;
}
