import { BadRequestException } from '@nestjs/common';
import {
  type CaCertFormat,
  changeFormat,
  normalizePublicFileName,
  resolveCreatedPublicFileName,
  resolveDownloadFileName,
  sanitizePublicBasename,
  splitFileName,
} from '../ca/ca-filename';

export type ServerCertFormat = CaCertFormat;
export type ServerKeyFormat = 'key' | 'pem';

const KEY_EXT = /^(.*?)(?:\.(key|pem))$/i;

export function buildDefaultServerPublicFileName(source: {
  name?: string;
  commonName?: string;
  firstIp?: string;
}): string {
  const stemSource = source.name || source.commonName || source.firstIp || 'server';
  return resolveCreatedPublicFileName(undefined, { commonName: stemSource });
}

export function resolveServerCertPublicFileName(
  requested: string | undefined,
  source: { name?: string; commonName?: string; firstIp?: string },
): string {
  if (requested?.trim()) {
    return normalizePublicFileName(requested, { defaultFormat: 'crt' });
  }
  return buildDefaultServerPublicFileName(source);
}

export function deriveServerKeyFileName(
  certFileName: string,
  format: ServerKeyFormat = 'key',
): string {
  const { stem } = splitFileName(certFileName);
  const safeStem = sanitizePublicBasename(stem) || 'server';
  return `${safeStem}.${format}`;
}

export function resolveServerCertDownloadName(options: {
  storedName: string;
  filename?: string;
  format?: string;
}): { filename: string; format: ServerCertFormat } {
  return resolveDownloadFileName(options);
}

export function resolveServerKeyDownloadName(options: {
  storedKeyName: string;
  filename?: string;
  format?: string;
}): { filename: string; format: ServerKeyFormat } {
  const requestedFormat = parseKeyFormat(options.format);
  if (options.filename?.trim()) {
    return normalizeKeyFileName(options.filename, requestedFormat ?? 'key');
  }
  if (requestedFormat) {
    const { stem } = splitKeyFileName(options.storedKeyName);
    const safeStem = sanitizePublicBasename(stem) || 'server';
    return { filename: `${safeStem}.${requestedFormat}`, format: requestedFormat };
  }
  const parsed = splitKeyFileName(options.storedKeyName);
  return { filename: options.storedKeyName, format: parsed.ext ?? 'key' };
}

export function parseKeyFormat(value: string | undefined): ServerKeyFormat | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (normalized !== 'key' && normalized !== 'pem') {
    throw new BadRequestException('私钥下载格式仅支持 key 或 pem。');
  }
  return normalized;
}

export function normalizeKeyFileName(
  input: string,
  format: ServerKeyFormat = 'key',
): { filename: string; format: ServerKeyFormat } {
  const trimmed = input.trim();
  if (trimmed.includes('/') || trimmed.includes('\\') || trimmed.includes('..')) {
    throw new BadRequestException('私钥文件名不能包含路径。');
  }
  if (/rootca\.key$/i.test(trimmed)) {
    throw new BadRequestException('禁止将文件命名为 rootCA.key。根 CA 私钥不可下载、不可上传。');
  }
  const match = trimmed.match(KEY_EXT);
  const stem = sanitizePublicBasename(match?.[1] ?? trimmed.replace(/\.[A-Za-z0-9]+$/, ''));
  if (!stem) {
    throw new BadRequestException('私钥文件名无效。');
  }
  const ext = (match?.[2]?.toLowerCase() as ServerKeyFormat | undefined) ?? format;
  if (ext !== 'key' && ext !== 'pem') {
    throw new BadRequestException('私钥文件名的扩展名仅支持 .key 或 .pem。');
  }
  return { filename: `${stem}.${ext}`, format: ext };
}

function splitKeyFileName(fileName: string): { stem: string; ext?: ServerKeyFormat } {
  const match = fileName.match(KEY_EXT);
  if (match?.[1] !== undefined && match[2]) {
    return { stem: match[1], ext: match[2].toLowerCase() as ServerKeyFormat };
  }
  return { stem: fileName };
}

export { changeFormat };
