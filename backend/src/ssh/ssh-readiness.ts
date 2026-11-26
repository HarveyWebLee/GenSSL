import type { SshAuthMethod, SshReadiness } from './ssh.types';

export function describeSshReadiness(input: {
  host?: string | null;
  sshUsername?: string | null;
  sshAuthMethod?: SshAuthMethod | null;
  hasPassword?: boolean;
  hasPrivateKey?: boolean;
}): SshReadiness {
  const missing: string[] = [];
  if (!input.host?.trim()) {
    missing.push('主机地址');
  }
  if (!input.sshUsername?.trim()) {
    missing.push('SSH 用户名');
  }
  const method = input.sshAuthMethod === 'privateKey' ? 'privateKey' : 'password';
  if (method === 'privateKey') {
    if (!input.hasPrivateKey) {
      missing.push('SSH 私钥');
    }
  } else if (!input.hasPassword) {
    missing.push('SSH 密码');
  }
  if (missing.length > 0) {
    return {
      ready: false,
      missing,
      reason: `尚未配置远程登录：缺少${missing.join('、')}。请先在「服务器与路径」中补全后再上传。`,
    };
  }
  return { ready: true, missing, reason: null };
}
