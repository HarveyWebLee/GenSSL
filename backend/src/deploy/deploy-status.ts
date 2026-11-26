import type { CertificateLifecycleStatus } from '../certs/cert-status';

export type DeployStaleReason = 'certificate_overwritten' | 'certificate_unavailable' | null;

export interface DeployStaleState {
  stale: boolean;
  staleReason: DeployStaleReason;
  staleLabel: string | null;
}

export function resolveDeployStale(options: {
  storedFingerprint?: string | null;
  currentFingerprint?: string | null;
  certStatus: CertificateLifecycleStatus;
  deployedAt: Date;
  certUpdatedAt?: Date | null;
}): DeployStaleState {
  const unavailable = options.certStatus === 'needs_regenerate' || options.certStatus === 'needs_reissue';
  const stored = options.storedFingerprint?.trim();
  const current = options.currentFingerprint?.trim();
  const fingerprintMismatch = Boolean(stored && current && stored !== current);
  const updatedAfterDeploy =
    !stored &&
    Boolean(
      options.certUpdatedAt &&
        options.deployedAt &&
        options.certUpdatedAt.getTime() > options.deployedAt.getTime() + 1000,
    );

  if (fingerprintMismatch || updatedAfterDeploy) {
    return {
      stale: true,
      staleReason: 'certificate_overwritten',
      staleLabel: '已过时（证书已重新生成，需重新上传）',
    };
  }
  if (unavailable) {
    return {
      stale: true,
      staleReason: 'certificate_unavailable',
      staleLabel:
        options.certStatus === 'needs_regenerate'
          ? '已过时（证书不可用，需先重新生成并覆盖）'
          : '已过时（证书已失效，需重签后再部署）',
    };
  }
  return { stale: false, staleReason: null, staleLabel: null };
}
