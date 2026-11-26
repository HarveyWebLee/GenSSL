import { ConflictException } from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { HostKeyDecision, HostKeyInfo, PinnedHostKey } from './ssh.types';

export function parseHostKeyInfo(rawKey: Buffer): HostKeyInfo {
  return {
    algorithm: parseSshKeyAlgorithm(rawKey),
    keyBase64: rawKey.toString('base64'),
    fingerprint: fingerprintSha256(rawKey),
  };
}

export function fingerprintSha256(rawKey: Buffer): string {
  const digest = createHash('sha256').update(rawKey).digest('base64').replace(/=+$/, '');
  return `SHA256:${digest}`;
}

export function parseSshKeyAlgorithm(rawKey: Buffer): string {
  if (rawKey.length < 4) {
    return 'unknown';
  }
  const length = rawKey.readUInt32BE(0);
  if (length <= 0 || length > 128 || 4 + length > rawKey.length) {
    return 'unknown';
  }
  return rawKey.subarray(4, 4 + length).toString('ascii');
}

export function hostKeysMatch(left: { keyBase64: string }, right: { keyBase64: string }): boolean {
  const a = Buffer.from(left.keyBase64, 'base64');
  const b = Buffer.from(right.keyBase64, 'base64');
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  return timingSafeEqual(a, b);
}

export function decideHostKey(options: {
  pinned?: PinnedHostKey | null;
  peer: HostKeyInfo;
  trustNewHostKey?: boolean;
}): HostKeyDecision {
  const { pinned, peer, trustNewHostKey } = options;
  if (!pinned?.keyBase64) {
    return { accept: true, newlyTrusted: true, peer };
  }
  if (hostKeysMatch(pinned, peer)) {
    return { accept: true, newlyTrusted: false, peer };
  }
  if (trustNewHostKey) {
    return { accept: true, newlyTrusted: true, peer };
  }
  throw new ConflictException(
    `远程主机密钥与已锁定的指纹不一致（已锁定 ${pinned.fingerprint}，本次为 ${peer.fingerprint}）。若确认这台机器已更换主机密钥，请在服务器设置中选择「重新信任主机密钥」后再试。`,
  );
}
