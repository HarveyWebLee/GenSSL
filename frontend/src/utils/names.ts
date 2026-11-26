export function sanitizeBasename(raw: string): string {
  let value = raw.normalize('NFC');
  value = value.replace(/[\u0000-\u001f\u007f]/g, '');
  value = value.replace(/[\\/:*?"<>|]/g, '-');
  value = value.replace(/\s+/g, '-');
  value = value.replace(/-+/g, '-');
  value = value.replace(/^[.\s-]+|[.\s-]+$/g, '');
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i.test(value)) {
    value = `${value}-CA`;
  }
  return value;
}

export function parseList(text?: string): string[] {
  if (!text?.trim()) {
    return [];
  }
  return text
    .split(/[\n,，;；]+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

export function suggestCaPublicFileName(commonName?: string): string {
  const stem = commonName?.trim() ? sanitizeBasename(commonName) : '';
  return `${stem || 'Root-CA'}.crt`;
}

export function withCertExtension(input: string, fallbackStem: string): string {
  const trimmed = input.trim();
  if (!trimmed) {
    return `${fallbackStem}.crt`;
  }
  if (/\.(crt|cer|pem)$/i.test(trimmed)) {
    return trimmed;
  }
  const stem = sanitizeBasename(trimmed) || fallbackStem;
  return `${stem}.crt`;
}

export function suggestServerCertNames(options: {
  firstIp?: string;
  name?: string;
  commonName?: string;
  publicFileName?: string;
}): { name: string; commonName: string; publicFileName: string; keyFileName: string } {
  const firstIp = options.firstIp?.trim();
  const commonName = options.commonName?.trim() || firstIp || 'server';
  const nameSource = options.name?.trim() || commonName || firstIp || 'server';
  const name = sanitizeBasename(nameSource) || 'server';
  const publicFileName = options.publicFileName?.trim()
    ? withCertExtension(options.publicFileName, name)
    : `${name}.crt`;
  const keyFileName = publicFileName.replace(/\.(crt|cer|pem)$/i, '.key');
  return { name, commonName, publicFileName, keyFileName };
}
