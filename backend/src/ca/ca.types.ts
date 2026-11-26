export type CaHashAlgorithm = 'sha256' | 'sha384' | 'sha512';
export type RootCaLifecycleStatus = 'active' | 'retired';

export interface CaSubjectInfo {
  country?: string;
  stateOrProvince?: string;
  locality?: string;
  organization?: string;
  organizationalUnit?: string;
  commonName?: string;
  emailAddress?: string;
}

export interface ArchiveStatus {
  storageKind: 'archive';
  storageLabel: '证书库';
  uploaded: boolean;
  objectKey: string | null;
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
  generation: number;
  regeneratedAt: string | null;
  certificateCount: number;
  validCertificateCount: number;
  needsReissueCount: number;
  needsRegenerateCount: number;
  archive: ArchiveStatus;
  createdAt: string;
  updatedAt: string;
}

export interface CaSigningMaterial {
  id: string;
  name: string;
  certPem: string;
  keyPem: string;
  publicFileName: string;
  status: RootCaLifecycleStatus;
  generation: number;
  fingerprintSha256: string;
}
