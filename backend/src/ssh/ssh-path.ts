import { BadRequestException } from '@nestjs/common';
import { assertSafeUploadFileName, isForbiddenUploadName } from '../storage/upload-guard';

const MAX_DIR_LENGTH = 512;
const MAX_FILE_NAME = 200;
const WINDOWS_DRIVE = /^[A-Za-z]:$/;
const WINDOWS_ABS = /^[A-Za-z]:[\\/]/;
const WINDOWS_SFTP = /^\/[A-Za-z]:(\/|$)/;

export function assertSafeRemoteDirectory(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BadRequestException('远程部署目录不能为空。');
  }
  if (trimmed.includes('\0') || /[\u0000-\u001F]/.test(trimmed)) {
    throw new BadRequestException('远程部署目录包含非法字符。');
  }
  if (trimmed.length > MAX_DIR_LENGTH) {
    throw new BadRequestException('远程部署目录过长。');
  }

  const unified = trimmed.replace(/\\/g, '/');
  if (!isAbsoluteRemotePath(unified)) {
    throw new BadRequestException('远程部署目录必须是绝对路径，例如 /etc/nginx/ssl 或 C:/nginx/ssl。');
  }

  const parts = splitRemoteSegments(unified);
  for (const part of parts) {
    if (part === '..') {
      throw new BadRequestException('远程部署目录不能包含「..」。');
    }
  }
  if (parts.length === 0) {
    throw new BadRequestException('远程部署目录无效。');
  }

  // 统一为正斜杠，便于 Linux 与 Windows OpenSSH 的 SFTP。
  if (WINDOWS_ABS.test(unified) || WINDOWS_SFTP.test(unified)) {
    const rest = WINDOWS_SFTP.test(unified) ? unified.slice(1) : unified;
    const [drive, ...tail] = rest.split('/').filter(Boolean);
    return `${drive}/${tail.join('/')}`.replace(/\/+$/, '');
  }
  const normalized = `/${parts.join('/')}`.replace(/\/+$/, '') || '/';
  return normalized;
}

export function assertSafeRemoteFileName(fileName: string): string {
  const safe = assertSafeUploadFileName(fileName);
  const base = safe.replace(/\\/g, '/').split('/').pop() ?? '';
  if (!base || base !== safe.replace(/\\/g, '/') || base === '.' || base === '..') {
    throw new BadRequestException('远程文件名无效，只能写入目标目录中的文件名，不能包含路径。');
  }
  if (base.includes('\0') || /[\u0000-\u001F]/.test(base)) {
    throw new BadRequestException('远程文件名包含非法字符。');
  }
  if (base.length > MAX_FILE_NAME) {
    throw new BadRequestException('远程文件名过长。');
  }
  if (isForbiddenUploadName(base)) {
    throw new BadRequestException(
      '禁止上传 rootCA.key。根 CA 私钥只保存在数据库中，不会出现在部署目录、远程服务器或证书库中。',
    );
  }
  return base;
}

export function joinRemoteFile(directory: string, fileName: string): string {
  const dir = assertSafeRemoteDirectory(directory);
  const base = assertSafeRemoteFileName(fileName);
  if (dir === '/') {
    return `/${base}`;
  }
  return `${dir}/${base}`;
}

export function formatRemoteDestination(options: {
  username?: string | null;
  host: string;
  port?: number | null;
  path: string;
}): string {
  const user = options.username?.trim() ? `${options.username.trim()}@` : '';
  const port = options.port && options.port !== 22 ? `:${options.port}` : '';
  return `${user}${options.host}${port}:${options.path}`;
}

function isAbsoluteRemotePath(path: string): boolean {
  return path.startsWith('/') || WINDOWS_ABS.test(path);
}

function splitRemoteSegments(path: string): string[] {
  let value = path;
  if (WINDOWS_SFTP.test(value)) {
    value = value.slice(1);
  }
  const parts = value.split('/').filter((part) => part && part !== '.');
  if (parts[0] && WINDOWS_DRIVE.test(parts[0])) {
    return parts.slice(1);
  }
  return parts;
}
