import { isIP } from 'node:net';
import { BadRequestException } from '@nestjs/common';
import type * as forge from 'node-forge';

/** node-forge / X.509: 2 = dNSName, 7 = iPAddress */
export const SAN_TYPE_DNS = 2;
export const SAN_TYPE_IP = 7;

export interface NormalizedSan {
  ips: string[];
  dnsNames: string[];
}

export interface ParsedSan extends NormalizedSan {
  display: string;
  /** True when any IP was incorrectly encoded as a DNS name. */
  hasIpEncodedAsDns: boolean;
  raw: SanAltName[];
}

export interface SanAltName {
  type: number;
  ip?: string;
  value?: string;
}

const IPV4_WITH_PORT = /^\d{1,3}(?:\.\d{1,3}){3}:\d+$/;
const IPV6_BRACKET_WITH_PORT = /^\[[0-9a-fA-F:]+\]:\d+$/;
const DNS_NAME =
  /^(?=.{1,253}$)(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)(?:\.(?:[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?))*$/;

export function looksLikeHostPort(value: string): boolean {
  return IPV4_WITH_PORT.test(value) || IPV6_BRACKET_WITH_PORT.test(value);
}

export function normalizeAndValidateIps(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) {
    throw new BadRequestException('至少需要填写一个服务器 IP 地址，并作为 IP Address 类型写入 SAN。');
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new BadRequestException('IP 地址必须是字符串。');
    }
    const trimmed = item.trim();
    if (!trimmed) {
      continue;
    }
    if (looksLikeHostPort(trimmed)) {
      throw new BadRequestException(
        `SAN 不能包含端口（证书与端口无关），请去掉端口后重试：${trimmed}`,
      );
    }
    const version = isIP(trimmed);
    if (version === 0) {
      throw new BadRequestException(
        `无效的 IP 地址「${trimmed}」。SAN 中的 IP 必须是 IP Address 类型，不能写成 DNS 名称。`,
      );
    }
    const key = version === 4 ? trimmed : trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }

  if (result.length === 0) {
    throw new BadRequestException('至少需要填写一个服务器 IP 地址，并作为 IP Address 类型写入 SAN。');
  }

  return result;
}

export function normalizeAndValidateDnsNames(raw: string[] | undefined): string[] {
  if (!raw || raw.length === 0) {
    return [];
  }

  const result: string[] = [];
  const seen = new Set<string>();

  for (const item of raw) {
    if (typeof item !== 'string') {
      throw new BadRequestException('DNS 名称必须是字符串。');
    }
    const trimmed = item.trim().replace(/\.$/, '');
    if (!trimmed) {
      continue;
    }
    if (looksLikeHostPort(trimmed) || /:\d+$/.test(trimmed)) {
      throw new BadRequestException(`DNS SAN 不能包含端口，请去掉端口后重试：${trimmed}`);
    }
    if (isIP(trimmed) !== 0) {
      throw new BadRequestException(
        `「${trimmed}」是 IP 地址，请填写到服务器 IP 列表中，以便以 IP Address 类型写入 SAN，而不是写成 DNS。`,
      );
    }
    if (!DNS_NAME.test(trimmed)) {
      throw new BadRequestException(`无效的 DNS 名称：${trimmed}`);
    }
    const key = trimmed.toLowerCase();
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

export function normalizeSan(input: { ips?: string[]; dnsNames?: string[] }): NormalizedSan {
  return {
    ips: normalizeAndValidateIps(input.ips),
    dnsNames: normalizeAndValidateDnsNames(input.dnsNames),
  };
}

/**
 * Build node-forge subjectAltName.altNames.
 * IPs MUST use type 7 (`ip`), never type 2 (`value`).
 */
export function buildSanAltNames(ips: string[], dnsNames: string[] = []): SanAltName[] {
  const normalized = normalizeSan({ ips, dnsNames });
  return [
    ...normalized.ips.map((ip) => ({ type: SAN_TYPE_IP, ip })),
    ...normalized.dnsNames.map((value) => ({ type: SAN_TYPE_DNS, value })),
  ];
}

export function formatSubjectAltNameDisplay(ips: string[], dnsNames: string[] = []): string {
  const lines = ['Subject Alternative Name:'];
  for (const ip of ips) {
    lines.push(`    IP Address: ${ip}`);
  }
  for (const dns of dnsNames) {
    lines.push(`    DNS: ${dns}`);
  }
  return lines.join('\n');
}

export function readSanFromCert(cert: forge.pki.Certificate): ParsedSan {
  const ext = cert.getExtension('subjectAltName') as
    | { altNames?: SanAltName[] }
    | undefined;
  const raw = Array.isArray(ext?.altNames) ? ext.altNames : [];

  const ips: string[] = [];
  const dnsNames: string[] = [];
  let hasIpEncodedAsDns = false;

  for (const entry of raw) {
    if (entry.type === SAN_TYPE_IP && entry.ip) {
      ips.push(entry.ip);
      continue;
    }
    if (entry.type === SAN_TYPE_DNS && entry.value) {
      dnsNames.push(entry.value);
      if (isIP(entry.value) !== 0) {
        hasIpEncodedAsDns = true;
      }
    }
  }

  return {
    ips,
    dnsNames,
    display: formatSubjectAltNameDisplay(ips, dnsNames),
    hasIpEncodedAsDns,
    raw,
  };
}

export function assertSanMatches(
  parsed: ParsedSan,
  expected: NormalizedSan,
): { ok: boolean; messages: string[] } {
  const messages: string[] = [];

  if (parsed.hasIpEncodedAsDns) {
    messages.push('证书 SAN 中存在被写成 DNS 的 IP 地址，必须使用 IP Address 类型。');
  }

  const actualIps = new Set(parsed.ips);
  const expectedIps = new Set(expected.ips);
  for (const ip of expectedIps) {
    if (!actualIps.has(ip)) {
      messages.push(`证书 SAN 缺少 IP Address: ${ip}`);
    }
  }
  for (const ip of actualIps) {
    if (!expectedIps.has(ip)) {
      messages.push(`证书 SAN 含有未请求的 IP Address: ${ip}`);
    }
  }

  const actualDns = new Set(parsed.dnsNames.map((n) => n.toLowerCase()));
  const expectedDns = new Set(expected.dnsNames.map((n) => n.toLowerCase()));
  for (const dns of expectedDns) {
    if (!actualDns.has(dns)) {
      messages.push(`证书 SAN 缺少 DNS: ${dns}`);
    }
  }
  for (const dns of actualDns) {
    if (!expectedDns.has(dns)) {
      messages.push(`证书 SAN 含有未请求的 DNS: ${dns}`);
    }
  }

  return { ok: messages.length === 0, messages };
}
