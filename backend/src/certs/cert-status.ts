import type { RootCaLifecycleStatus } from '../ca/root-ca.entity';

export type CertificateLifecycleStatus =
  | 'valid'
  | 'expired'
  | 'not_yet_valid'
  | 'needs_reissue';

export function computeCertificateStatus(options: {
  caStatus: RootCaLifecycleStatus;
  notBefore: Date;
  notAfter: Date;
  now?: Date;
}): CertificateLifecycleStatus {
  if (options.caStatus === 'retired') {
    return 'needs_reissue';
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

export function certificateStatusLabel(status: CertificateLifecycleStatus): string {
  switch (status) {
    case 'needs_reissue':
      return '已失效（需重签）';
    case 'expired':
      return '已过期';
    case 'not_yet_valid':
      return '尚未生效';
    default:
      return '有效';
  }
}
