import type { CertificateLifecycleStatus } from '../api/types';

export function certStatusColor(status: CertificateLifecycleStatus): string {
  switch (status) {
    case 'valid':
      return 'success';
    case 'needs_reissue':
      return 'warning';
    case 'needs_regenerate':
      return 'error';
    case 'expired':
      return 'default';
    case 'not_yet_valid':
      return 'default';
    default:
      return 'default';
  }
}

export function certStatusLabel(status: CertificateLifecycleStatus): string {
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

export const REGENERATE_DISABLED_REASON = '所属根证书已停用，不能重新生成。请改用一棵启用中的根证书重新签发。';
export const DEPLOY_BLOCKED_REASON = '该证书因所属根证书被覆盖而不可用，不能部署。请先重新生成并覆盖，再重新上传。';
export const DEPLOY_REISSUE_WARNING = '该证书所属根已停用，仅建议在迁移期间临时部署。';
