import type { RootCaLifecycleStatus } from '../ca/root-ca.entity';

export type CertificateLifecycleStatus =
  | 'valid'
  | 'expired'
  | 'not_yet_valid'
  | 'needs_reissue'
  | 'needs_regenerate';

export type CertificateUnavailableReason = 'ca_retired' | 'ca_regenerated' | null;

export function computeCertificateStatus(options: {
  caStatus: RootCaLifecycleStatus;
  caGeneration?: number | null;
  certCaGeneration?: number | null;
  issuerFingerprintSha256?: string | null;
  caFingerprintSha256?: string | null;
  notBefore: Date;
  notAfter: Date;
  now?: Date;
}): CertificateLifecycleStatus {
  if (options.caStatus === 'retired') {
    return 'needs_reissue';
  }
  if (isSignedBySupersededRoot(options)) {
    return 'needs_regenerate';
  }
  const now = options.now ?? new Date();
  if (now < options.notBefore) {
    return 'not_yet_valid';
  }
  if (now > options.notAfter) {
    return 'expired';
  }
  return 'valid';
}

export function certificateUnavailableReason(
  status: CertificateLifecycleStatus,
): CertificateUnavailableReason {
  if (status === 'needs_reissue') {
    return 'ca_retired';
  }
  if (status === 'needs_regenerate') {
    return 'ca_regenerated';
  }
  return null;
}

export function certificateStatusLabel(status: CertificateLifecycleStatus): string {
  switch (status) {
    case 'needs_reissue':
      return '已失效（需重签）';
    case 'needs_regenerate':
      return '不可用，需重新生成并覆盖';
    case 'expired':
      return '已过期';
    case 'not_yet_valid':
      return '尚未生效';
    default:
      return '有效';
  }
}

export function hashAlgorithmFromSignature(
  signatureAlgorithm?: string | null,
): 'sha256' | 'sha384' | 'sha512' {
  const value = (signatureAlgorithm ?? '').toLowerCase();
  if (value.includes('sha384')) {
    return 'sha384';
  }
  if (value.includes('sha512')) {
    return 'sha512';
  }
  return 'sha256';
}

export function validityDays(notBefore: Date, notAfter: Date): number {
  return Math.max(1, Math.round((notAfter.getTime() - notBefore.getTime()) / (24 * 60 * 60 * 1000)));
}

function isSignedBySupersededRoot(options: {
  caGeneration?: number | null;
  certCaGeneration?: number | null;
  issuerFingerprintSha256?: string | null;
  caFingerprintSha256?: string | null;
}): boolean {
  const caGeneration = options.caGeneration ?? 1;
  const certCaGeneration = options.certCaGeneration ?? 1;
  if (caGeneration !== certCaGeneration) {
    return true;
  }
  const issuerFingerprint = options.issuerFingerprintSha256?.trim();
  const caFingerprint = options.caFingerprintSha256?.trim();
  return Boolean(issuerFingerprint && caFingerprint && issuerFingerprint !== caFingerprint);
}
