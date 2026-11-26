import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { assertSafeRemoteDirectory, assertSafeRemoteFileName, joinRemoteFile } from './ssh-path';

describe('remote path validation', () => {
  it('accepts Linux and Windows absolute directories and normalizes slashes', () => {
    assert.equal(assertSafeRemoteDirectory('/etc/nginx/ssl'), '/etc/nginx/ssl');
    assert.equal(assertSafeRemoteDirectory('C:\\\\nginx\\\\ssl'), 'C:/nginx/ssl');
    assert.equal(assertSafeRemoteDirectory('C:/nginx/ssl/'), 'C:/nginx/ssl');
    assert.equal(assertSafeRemoteDirectory('/C:/nginx/ssl'), 'C:/nginx/ssl');
  });

  it('rejects traversal, NUL, relative paths and rootCA.key file names', () => {
    assert.throws(() => assertSafeRemoteDirectory('etc/nginx/ssl'), BadRequestException);
    assert.throws(() => assertSafeRemoteDirectory('/etc/nginx/../ssl'), BadRequestException);
    assert.throws(() => assertSafeRemoteDirectory('/etc/nginx/\0ssl'), BadRequestException);
    assert.throws(() => assertSafeRemoteFileName('rootCA.key'), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      assert.match(String((error as BadRequestException).message), /rootCA\.key/);
      return true;
    });
    assert.throws(() => assertSafeRemoteFileName('../server.crt'), BadRequestException);
    assert.throws(() => assertSafeRemoteFileName('nested/server.crt'), BadRequestException);
  });

  it('joins only a bare file name onto the directory', () => {
    assert.equal(joinRemoteFile('/etc/nginx/ssl', '192.168.99.242.crt'), '/etc/nginx/ssl/192.168.99.242.crt');
    assert.equal(joinRemoteFile('C:\\\\nginx\\\\ssl', 'server.key'), 'C:/nginx/ssl/server.key');
  });
});
