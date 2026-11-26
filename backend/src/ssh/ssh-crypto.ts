import { BadRequestException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_LENGTH = 12;
const KEY_LENGTH = 32;
const PREFIX = 'v1';

/** 仅用于非生产环境、未配置 GENSSL_SSH_CREDENTIAL_KEY 时的开发默认口令，不会出现在 API 或日志中。 */
export const DEV_SSH_CREDENTIAL_KEY_FALLBACK = 'genssl-dev-ssh-credential-key-v1';

@Injectable()
export class SshCryptoService {
  constructor(private readonly config: ConfigService) {}

  isProductionLike(): boolean {
    const env = (this.config.get<string>('NODE_ENV') ?? process.env.NODE_ENV ?? '').trim().toLowerCase();
    const strict = (this.config.get<string>('GENSSL_STRICT_SECRETS') ?? process.env.GENSSL_STRICT_SECRETS ?? '')
      .trim()
      .toLowerCase();
    return env === 'production' || strict === 'true' || strict === '1' || strict === 'yes';
  }

  hasConfiguredKey(): boolean {
    return Boolean(this.readConfiguredKey());
  }

  assertReadyForUse(): void {
    if (!this.hasConfiguredKey() && this.isProductionLike()) {
      throw new BadRequestException(
        '未配置 GENSSL_SSH_CREDENTIAL_KEY，无法加解密 SSH 凭据。请在环境变量中设置 32 字节十六进制密钥（64 个字符）后重试。',
      );
    }
  }

  encrypt(plaintext: string): string {
    const key = this.getKey();
    const iv = randomBytes(IV_LENGTH);
    const cipher = createCipheriv(ALGO, key, iv);
    const encrypted = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return `${PREFIX}:${iv.toString('base64')}:${tag.toString('base64')}:${encrypted.toString('base64')}`;
  }

  decrypt(payload: string): string {
    const key = this.getKey();
    const trimmed = payload?.trim();
    if (!trimmed) {
      throw new BadRequestException('SSH 凭据缺失，无法解密。');
    }
    const parts = trimmed.split(':');
    if (parts.length !== 4 || parts[0] !== PREFIX) {
      throw new BadRequestException('SSH 凭据格式无效，无法解密。');
    }
    try {
      const iv = Buffer.from(parts[1]!, 'base64');
      const tag = Buffer.from(parts[2]!, 'base64');
      const encrypted = Buffer.from(parts[3]!, 'base64');
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      return Buffer.concat([decipher.update(encrypted), decipher.final()]).toString('utf8');
    } catch {
      throw new BadRequestException(
        'SSH 凭据无法解密。请确认 GENSSL_SSH_CREDENTIAL_KEY 与写入时使用的密钥一致。',
      );
    }
  }

  encryptIfPresent(value: string | undefined | null): string | null {
    const trimmed = value?.trim();
    if (!trimmed) {
      return null;
    }
    return this.encrypt(trimmed);
  }

  private getKey(): Buffer {
    this.assertReadyForUse();
    const configured = this.readConfiguredKey();
    if (configured) {
      return this.normalizeKey(configured);
    }
    return this.normalizeKey(DEV_SSH_CREDENTIAL_KEY_FALLBACK);
  }

  private readConfiguredKey(): string | null {
    const raw =
      this.config.get<string>('GENSSL_SSH_CREDENTIAL_KEY')?.trim() ||
      process.env.GENSSL_SSH_CREDENTIAL_KEY?.trim() ||
      '';
    return raw || null;
  }

  private normalizeKey(raw: string): Buffer {
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
      return Buffer.from(raw, 'hex');
    }
    return createHash('sha256').update(raw, 'utf8').digest().subarray(0, KEY_LENGTH);
  }
}
