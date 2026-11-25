import { BadRequestException } from '@nestjs/common';
import { assertSafeObjectKey, assertSafeUploadFileName } from './upload-guard';

export function sanitizeKeySegment(raw: string): string {
  const value = raw
    .normalize('NFC')
    .replace(/[\\]/g, '/')
    .replace(/[^\p{L}\p{N}._-]+/gu, '-')
    .replace(/-+/g, '-')
    .replace(/^[.-]+|[.-]+$/g, '');
  if (!value) {
    throw new BadRequestException('无法从名称生成有效的存储路径段。');
  }
  return value;
}

export function normalizeDeployPath(raw: string): string {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new BadRequestException('部署路径不能为空。');
  }
  const unified = trimmed.replace(/\\/g, '/');
  const parts = unified.split('/').filter((part) => part && part !== '.' && part !== ':');
  const cleaned: string[] = [];
  for (const part of parts) {
    if (part === '..') {
      throw new BadRequestException('部署路径不能包含「..」。');
    }
    // Keep drive letter like "E:" by stripping colon already handled; "E" remains
    const segment = part.endsWith(':') ? part.slice(0, -1) : part;
    if (segment) {
      cleaned.push(segment);
    }
  }
  if (cleaned.length === 0) {
    throw new BadRequestException('部署路径无效。');
  }
  return cleaned.join('/');
}

export function buildObjectPrefix(serverName: string, deployPath: string): string {
  const server = sanitizeKeySegment(serverName);
  const pathPrefix = normalizeDeployPath(deployPath)
    .split('/')
    .map((part) => sanitizeKeySegment(part))
    .join('/');
  return `${server}/${pathPrefix}`;
}

export function buildObjectKey(serverName: string, deployPath: string, fileName: string): string {
  const safeName = assertSafeUploadFileName(fileName);
  const base = safeName.split(/[\\/]/).pop() ?? safeName;
  return assertSafeObjectKey(`${buildObjectPrefix(serverName, deployPath)}/${base}`);
}
