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

export interface IssueCertPayload {
  name?: string;
  ips: string[];
  dnsNames?: string[];
  country?: string;
  organization?: string;
  organizationalUnit?: string;
  commonName?: string;
  days?: number;
  overwrite?: boolean;
}

export interface GenerateNginxPayload {
  serverName?: string;
  listenPort?: number;
  rootPath?: string;
  proxyPass?: string;
  sslCertificate?: string;
  sslCertificateKey?: string;
}
