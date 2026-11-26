const WINDOWS_ABS = /^[A-Za-z]:[\\/]/;

export function validateNginxConfigPath(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) {
    return '请填写 Nginx 配置文件路径。';
  }
  if (/[\u0000-\u001F]/.test(value)) {
    return '路径包含非法字符。';
  }
  if (!value.startsWith('/') && !WINDOWS_ABS.test(value.replace(/\\/g, '/'))) {
    return '必须是绝对路径，例如 /data/smartsecurity/nginx/vhost/avatar.conf。';
  }
  if (value.split(/[\\/]/).includes('..')) {
    return '路径不能包含「..」。';
  }
  if (!/\.conf$/i.test(value)) {
    return '路径必须以 .conf 结尾。';
  }
  const fileName = value.replace(/\\/g, '/').split('/').filter(Boolean).pop() ?? '';
  if (!fileName || fileName === '.conf') {
    return '请填写完整的配置文件名，例如 avatar.conf。';
  }
  return undefined;
}

export function validateRestartCommand(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) {
    return '请填写重启服务命令。该命令将在目标服务器上通过 SSH 执行，不会在本平台执行。';
  }
  if (value.length > 500) {
    return '重启服务命令过长，请控制在 500 个字符以内。';
  }
  if (/[\u0000-\u0008\u000A-\u001F]/.test(value)) {
    return '重启服务命令包含非法字符，请使用单行命令。';
  }
  return undefined;
}

export function validateVersion(raw: string): string | undefined {
  const value = raw.trim();
  if (!value) {
    return '请填写版本号。';
  }
  if (value.length > 64) {
    return '版本号请控制在 64 个字符以内。';
  }
  if (!/^[A-Za-z0-9._+-]+$/.test(value)) {
    return '版本号仅支持字母、数字、点、下划线、加号和短横线。';
  }
  return undefined;
}

export async function readConfFile(file: File): Promise<string> {
  if (!/\.conf$/i.test(file.name)) {
    throw new Error('只能上传以 .conf 结尾的配置文件。');
  }
  if (file.size > 256 * 1024) {
    throw new Error('配置文件过大，请控制在 256 KB 以内。');
  }
  const text = (await file.text()).replace(/^\uFEFF/, '');
  if (!text.trim()) {
    throw new Error('上传的配置文件是空的。');
  }
  return text;
}
