import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  assertSafeObjectKey,
  assertSafeUploadFileName,
  isForbiddenUploadName,
} from './upload-guard';

describe('upload-guard', () => {
  it('forbids uploading rootCA.key in any casing or path', () => {
    for (const name of ['rootCA.key', 'ROOTCA.KEY', 'RootCa.Key', 'dir/rootCA.key']) {
      assert.equal(isForbiddenUploadName(name), true);
      assert.throws(
        () => assertSafeUploadFileName(name),
        (error: unknown) =>
          error instanceof BadRequestException &&
          String((error as BadRequestException).message).includes('rootCA.key'),
      );
    }

    assert.throws(
      () => assertSafeObjectKey('web-01/etc/nginx/ssl/rootCA.key'),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('allows server certificate and server private key names', () => {
    for (const name of ['server.crt', 'server.key', 'web-192-168-99-242.pem', '公司证书.cer']) {
      assert.equal(isForbiddenUploadName(name), false);
      assert.equal(assertSafeUploadFileName(name), name);
    }
  });

  it('rejects object key path traversal', () => {
    assert.throws(
      () => assertSafeObjectKey('../rootCA.crt'),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.throws(
      () => assertSafeObjectKey('/etc/nginx/ssl/server.crt'),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});
