import { BadRequestException } from '@nestjs/common';
import path from 'node:path';

const ROOT_CA_KEY = /^rootca\.key$/i;

export function isForbiddenUploadName(fileName: string): boolean {
  const base = path.posix.basename(fileName.replace(/\\/g, '/'));
  return ROOT_CA_KEY.test(base) || ROOT_CA_KEY.test(fileName.trim());
}

export function assertSafeUploadFileName(fileName: string): string {
  const trimmed = fileName.trim();
  if (!trimmed) {
    throw new BadRequestException('上传文件名不能为空。');
  }
  if (isForbiddenUploadName(trimmed)) {
    throw new BadRequestException(
      '禁止上传 rootCA.key。根 CA 私钥只能保存在证书管理端本机，不得入库，也不得上传到文件服务器。',
    );
  }
  return trimmed;
}

export function assertSafeObjectKey(objectKey: string): string {
  const trimmed = objectKey.trim();
  if (!trimmed) {
    throw new BadRequestException('对象键不能为空。');
  }
  if (trimmed.includes('\\') || trimmed.includes('\0')) {
    throw new BadRequestException('对象键无效。');
  }
  const parts = trimmed.split('/');
  if (parts.some((part) => part === '..' || part === '')) {
    throw new BadRequestException('对象键不能包含路径穿越。');
  }
  if (isForbiddenUploadName(trimmed)) {
    throw new BadRequestException(
      '禁止上传或下载 rootCA.key。根 CA 私钥不得出现在文件服务器中。',
    );
  }
  return trimmed;
}

export function isServerPrivateKeyName(fileName: string): boolean {
  const base = path.posix.basename(fileName.replace(/\\/g, '/')).toLowerCase();
  if (ROOT_CA_KEY.test(base)) {
    return false;
  }
  return base.endsWith('.key') || (base.endsWith('.pem') && /(?:^|[-_.])key(?:\.pem)?$/i.test(base));
}
