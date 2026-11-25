import { BadRequestException } from '@nestjs/common';

export const CA_CERT_FORMATS = ['crt', 'cer', 'pem'] as const;
export type CaCertFormat = (typeof CA_CERT_FORMATS)[number];

export const CA_META_FILE = 'ca.meta.json';
export const DEFAULT_PUBLIC_BASENAME = 'Root-CA';
export const MAX_PUBLIC_FILENAME_LENGTH = 200;

const WINDOWS_ILLEGAL = /[\\/:*?"<>|]/;
const WINDOWS_ILLEGAL_GLOBAL = /[\\/:*?"<>|]/g;
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/g;
const CERT_EXT_PATTERN = /^(.*?)(?:\.(crt|cer|pem))$/i;
const ANY_EXT_PATTERN = /^(.*)\.([A-Za-z0-9]+)$/;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

export interface CaSubjectNameSource {
  commonName?: string;
  organization?: string;
}

export function isCaCertFormat(value: string): value is CaCertFormat {
  return (CA_CERT_FORMATS as readonly string[]).includes(value.toLowerCase());
}

export function parseCertFormat(value: string | undefined): CaCertFormat | undefined {
  if (!value?.trim()) {
    return undefined;
  }
  const normalized = value.trim().toLowerCase();
  if (!isCaCertFormat(normalized)) {
    throw new BadRequestException('下载格式仅支持 crt、cer 或 pem。');
  }
  return normalized;
}

export function sanitizePublicBasename(raw: string): string {
  let value = raw.normalize('NFC');
  value = value.replace(CONTROL_CHARS, '');
  value = value.replace(WINDOWS_ILLEGAL_GLOBAL, '-');
  value = value.replace(/\s+/g, '-');
  value = value.replace(/-+/g, '-');
  value = value.replace(/^[.\s-]+|[.\s-]+$/g, '');
  if (WINDOWS_RESERVED.test(value)) {
    value = `${value}-CA`;
  }
  return value;
}

export function buildDefaultPublicFileName(subject: CaSubjectNameSource): string {
  const fromCommonName = subject.commonName
    ? sanitizePublicBasename(subject.commonName)
    : '';
  if (fromCommonName) {
    return applyFormat(fromCommonName, 'crt');
  }

  const fromOrganization = subject.organization
    ? sanitizePublicBasename(subject.organization)
    : '';
  if (fromOrganization) {
    return applyFormat(`${fromOrganization}-Root-CA`, 'crt');
  }

  return applyFormat(DEFAULT_PUBLIC_BASENAME, 'crt');
}

export function resolveCreatedPublicFileName(
  requested: string | undefined,
  subject: CaSubjectNameSource,
): string {
  if (!requested?.trim()) {
    return truncateFileName(buildDefaultPublicFileName(subject));
  }
  return normalizePublicFileName(requested, { defaultFormat: 'crt' });
}

export function normalizePublicFileName(
  input: string,
  options?: { defaultFormat?: CaCertFormat; format?: CaCertFormat },
): string {
  const trimmed = input.trim();
  assertNoPathTraversal(trimmed);

  const parsed = splitFileName(trimmed);
  if (parsed.explicitExt && !isCaCertFormat(parsed.explicitExt)) {
    throw new BadRequestException(
      '公共文件名的扩展名仅支持 .crt、.cer 或 .pem。',
    );
  }

  const format = options?.format ?? parsed.ext ?? options?.defaultFormat ?? 'crt';
  const stem = sanitizePublicBasename(parsed.stem);
  if (!stem) {
    throw new BadRequestException('公共文件名无效，请使用不含路径的文件名。');
  }

  return truncateFileName(applyFormat(stem, format));
}

export function resolveDownloadFileName(options: {
  storedName: string;
  filename?: string;
  format?: string;
}): { filename: string; format: CaCertFormat } {
  const requestedFormat = parseCertFormat(options.format);
  const base = options.filename?.trim()
    ? normalizePublicFileName(options.filename, {
        defaultFormat: requestedFormat ?? 'crt',
        format: requestedFormat,
      })
    : changeFormat(
        options.storedName,
        requestedFormat ?? splitFileName(options.storedName).ext ?? 'crt',
      );

  const format = splitFileName(base).ext ?? 'crt';
  return { filename: base, format };
}

export function changeFormat(fileName: string, format: CaCertFormat): string {
  const { stem } = splitFileName(fileName);
  const safeStem = sanitizePublicBasename(stem) || DEFAULT_PUBLIC_BASENAME;
  return truncateFileName(applyFormat(safeStem, format));
}

export function splitFileName(fileName: string): {
  stem: string;
  ext?: CaCertFormat;
  explicitExt?: string;
} {
  const certMatch = fileName.match(CERT_EXT_PATTERN);
  if (certMatch?.[1] !== undefined && certMatch[2]) {
    return {
      stem: certMatch[1],
      ext: certMatch[2].toLowerCase() as CaCertFormat,
      explicitExt: certMatch[2].toLowerCase(),
    };
  }

  const anyMatch = fileName.match(ANY_EXT_PATTERN);
  if (anyMatch?.[1] !== undefined && anyMatch[2]) {
    return {
      stem: anyMatch[1],
      explicitExt: anyMatch[2].toLowerCase(),
    };
  }

  return { stem: fileName };
}

export function contentTypeForFormat(format: CaCertFormat): string {
  return format === 'pem' ? 'application/x-pem-file' : 'application/x-x509-ca-cert';
}

export function toAsciiFileName(fileName: string): string {
  const parsed = splitFileName(fileName);
  const format = parsed.ext ?? 'crt';
  let stem = parsed.stem
    .replace(/[^\x20-\x7E]/g, '_')
    .replace(/["\\]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[._-]+|[._-]+$/g, '');

  if (!stem) {
    stem = DEFAULT_PUBLIC_BASENAME;
  }
  return applyFormat(stem, format);
}

export function buildContentDisposition(fileName: string): string {
  const ascii = toAsciiFileName(fileName);
  const escaped = ascii.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  const header = `attachment; filename="${escaped}"`;
  if (ascii !== fileName || /[^\x20-\x7E]/.test(fileName)) {
    return `${header}; filename*=UTF-8''${encodeRfc5987(fileName)}`;
  }
  return header;
}

function applyFormat(stem: string, format: CaCertFormat): string {
  return `${stem}.${format}`;
}

function truncateFileName(fileName: string): string {
  if (fileName.length <= MAX_PUBLIC_FILENAME_LENGTH) {
    return fileName;
  }
  const { stem, ext } = splitFileName(fileName);
  const format = ext ?? 'crt';
  const suffix = `.${format}`;
  const maxStem = Math.max(1, MAX_PUBLIC_FILENAME_LENGTH - suffix.length);
  const truncated = sanitizePublicBasename(stem.slice(0, maxStem)) || DEFAULT_PUBLIC_BASENAME;
  return `${truncated.slice(0, maxStem)}${suffix}`;
}

function assertNoPathTraversal(value: string): void {
  if (WINDOWS_ILLEGAL.test(value) && /[\\/]/.test(value)) {
    throw new BadRequestException('公共文件名不能包含路径分隔符。');
  }
  if (value.includes('/') || value.includes('\\')) {
    throw new BadRequestException('公共文件名不能包含路径分隔符。');
  }
  if (value.includes('\0')) {
    throw new BadRequestException('公共文件名无效。');
  }

  const { stem } = splitFileName(value);
  const trimmedStem = stem.trim().replace(/^\.+|\.+$/g, '');
  if (stem === '..' || stem === '.' || trimmedStem === '..' || trimmedStem === '.') {
    throw new BadRequestException('公共文件名不能包含路径穿越。');
  }
  if (value === '..' || value === '.' || value.split(/[\\/]/).some((part) => part === '..')) {
    throw new BadRequestException('公共文件名不能包含路径穿越。');
  }
}

function encodeRfc5987(value: string): string {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => {
    return `%${char.charCodeAt(0).toString(16).toUpperCase()}`;
  });
}
