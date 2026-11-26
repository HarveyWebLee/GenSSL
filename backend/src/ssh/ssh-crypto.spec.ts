import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { SshCryptoService } from './ssh-crypto';

function service(env: Record<string, string | undefined> = {}) {
  const map: Record<string, string | undefined> = { NODE_ENV: 'test', ...env };
  const config = {
    get(key: string) {
      return map[key];
    },
  } as ConfigService;
  return new SshCryptoService(config);
}

describe('SshCryptoService', () => {
  it('encrypts and decrypts with a 64-character hex key', () => {
    const crypto = service({
      GENSSL_SSH_CREDENTIAL_KEY: '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef',
    });
    const secret = 's3cret-password';
    const encrypted = crypto.encrypt(secret);
    assert.equal(encrypted.startsWith('v1:'), true);
    assert.equal(encrypted.includes(secret), false);
    assert.equal(crypto.decrypt(encrypted), secret);
  });

  it('uses the development fallback when the env key is missing outside production', () => {
    const crypto = service({ NODE_ENV: 'development' });
    const encrypted = crypto.encrypt('hello');
    assert.equal(crypto.decrypt(encrypted), 'hello');
  });

  it('refuses to encrypt in production-like environments without a configured key', () => {
    const crypto = service({ NODE_ENV: 'production' });
    assert.equal(crypto.isProductionLike(), true);
    assert.throws(() => crypto.encrypt('hello'), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(String((error as BadRequestException).message), /未配置 GENSSL_SSH_CREDENTIAL_KEY/);
      return true;
    });
  });

  it('fails clearly when decrypting with a different key', () => {
    const a = service({
      GENSSL_SSH_CREDENTIAL_KEY: 'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    });
    const b = service({
      GENSSL_SSH_CREDENTIAL_KEY: 'bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb',
    });
    const encrypted = a.encrypt('value');
    assert.throws(() => b.decrypt(encrypted), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(String((error as BadRequestException).message), /无法解密/);
      return true;
    });
  });
});
