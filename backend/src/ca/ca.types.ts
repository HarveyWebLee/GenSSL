export type CaHashAlgorithm = 'sha256' | 'sha384' | 'sha512';

export interface CaSubjectInfo {
  country?: string;
  stateOrProvince?: string;
  locality?: string;
  organization?: string;
  organizationalUnit?: string;
  commonName?: string;
  emailAddress?: string;
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
