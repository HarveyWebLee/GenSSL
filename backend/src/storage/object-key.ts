import { BadRequestException } from '@nestjs/common';
import path from 'node:path';
import { assertSafeObjectKey, assertSafeUploadFileName, isForbiddenUploadName } from './upload-guard';

export const ARCHIVE_ROOT = 'archive';
export const DEPLOY_ROOT = 'deploy';
export const NGINX_ROOT = 'nginx';

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type StorageKind = 'archive' | 'deploy' | 'nginx';

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

export function assertUuidSegment(value: string, label: string): string {
  const trimmed = value.trim();
  if (!UUID_RE.test(trimmed)) {
    throw new BadRequestException(`${label} 无效。`);
  }
  return trimmed.toLowerCase();
}

function fileBaseName(fileName: string): string {
  const safeName = assertSafeUploadFileName(fileName);
  const base = safeName.split(/[\\/]/).pop() ?? safeName;
  if (!base || isForbiddenUploadName(base)) {
    throw new BadRequestException(
      '禁止上传 rootCA.key。根 CA 私钥只保存在数据库中，不得出现在文件服务器里。',
    );
  }
  return base;
}

/** 证书管理库：根证书公钥。永远不会是 rootCA.key。 */
export function buildArchiveCaObjectKey(caId: string, fileName = 'rootCA.crt'): string {
  const id = assertUuidSegment(caId, '根证书 ID');
  return assertSafeObjectKey(`${ARCHIVE_ROOT}/cas/${id}/${fileBaseName(fileName)}`);
}

export function buildArchiveCaPrefix(caId: string): string {
  const id = assertUuidSegment(caId, '根证书 ID');
  return `${ARCHIVE_ROOT}/cas/${id}`;
}

/** 证书管理库：某张服务器证书的目录。 */
export function buildArchiveCertPrefix(caId: string, certId: string): string {
  const ca = assertUuidSegment(caId, '根证书 ID');
  const cert = assertUuidSegment(certId, '服务器证书 ID');
  return `${ARCHIVE_ROOT}/certs/${ca}/${cert}`;
}

export function buildArchiveCertObjectKey(caId: string, certId: string, fileName: string): string {
  return assertSafeObjectKey(`${buildArchiveCertPrefix(caId, certId)}/${fileBaseName(fileName)}`);
}

/** 部署到某台服务器 cert 目录（或用户登记的部署路径）对应的前缀。 */
export function buildDeployObjectPrefix(serverName: string, deployPath: string): string {
  const server = sanitizeKeySegment(serverName);
  const pathPrefix = normalizeDeployPath(deployPath)
    .split('/')
    .map((part) => sanitizeKeySegment(part))
    .join('/');
  return `${DEPLOY_ROOT}/${server}/${pathPrefix}`;
}

export function buildDeployObjectKey(serverName: string, deployPath: string, fileName: string): string {
  return assertSafeObjectKey(`${buildDeployObjectPrefix(serverName, deployPath)}/${fileBaseName(fileName)}`);
}

export function classifyStorageKind(objectKey: string): StorageKind {
  const key = assertSafeObjectKey(objectKey);
  if (key === ARCHIVE_ROOT || key.startsWith(`${ARCHIVE_ROOT}/`)) {
    return 'archive';
  }
  if (key === DEPLOY_ROOT || key.startsWith(`${DEPLOY_ROOT}/`)) {
    return 'deploy';
  }
  if (key === NGINX_ROOT || key.startsWith(`${NGINX_ROOT}/`)) {
    return 'nginx';
  }
  throw new BadRequestException(
    '对象键必须位于证书库（archive/）、服务器部署目录（deploy/）或 Nginx 配置管理副本（nginx/）下。',
  );
}

export function assertArchiveObjectKey(objectKey: string): string {
  const key = assertSafeObjectKey(objectKey);
  if (classifyStorageKind(key) !== 'archive') {
    throw new BadRequestException('该对象不属于证书库（archive/）。');
  }
  return key;
}

export function assertDeployObjectKey(objectKey: string): string {
  const key = assertSafeObjectKey(objectKey);
  if (classifyStorageKind(key) !== 'deploy') {
    throw new BadRequestException('该对象不属于服务器部署目录（deploy/）。');
  }
  return key;
}

export function storageKindLabel(kind: StorageKind): string {
  if (kind === 'archive') {
    return '证书库';
  }
  if (kind === 'nginx') {
    return 'Nginx 配置管理副本';
  }
  return '服务器部署目录';
}

/** Nginx 服务当前配置在文件服务器中的管理副本，不是服务器上的真实文件。 */
export function buildNginxServiceObjectKey(serviceId: string, fileName = 'current.conf'): string {
  const id = assertUuidSegment(serviceId, 'Nginx 服务 ID');
  return assertSafeObjectKey(`${NGINX_ROOT}/services/${id}/${fileBaseName(fileName)}`);
}

/** 某次发布的配置快照，发布成功后作为管理档案保留。 */
export function buildNginxReleaseObjectKey(serviceId: string, releaseId: string, fileName = 'service.conf'): string {
  const service = assertUuidSegment(serviceId, 'Nginx 服务 ID');
  const release = assertUuidSegment(releaseId, '发布记录 ID');
  return assertSafeObjectKey(`${NGINX_ROOT}/services/${service}/releases/${release}/${fileBaseName(fileName)}`);
}

export function fileNameFromObjectKey(objectKey: string): string {
  return path.posix.basename(objectKey);
}
