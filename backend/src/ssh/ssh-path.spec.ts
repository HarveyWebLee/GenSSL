import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { assertRestartCommand, assertSafeRemoteConfPath, assertSafeRemoteDirectory, assertSafeRemoteFileName, joinRemoteFile, splitRemoteConfPath } from './ssh-path';

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

  it('accepts absolute nginx conf paths and rejects relative, traversal or non-conf files', () => {
    assert.equal(
      assertSafeRemoteConfPath('/data/smartsecurity/nginx/vhost/avatar.conf'),
      '/data/smartsecurity/nginx/vhost/avatar.conf',
    );
    assert.deepEqual(splitRemoteConfPath('/data/smartsecurity/nginx/vhost/avatar.conf'), {
      path: '/data/smartsecurity/nginx/vhost/avatar.conf',
      directory: '/data/smartsecurity/nginx/vhost',
      fileName: 'avatar.conf',
    });
    assert.throws(() => assertSafeRemoteConfPath('vhost/avatar.conf'), BadRequestException);
    assert.throws(() => assertSafeRemoteConfPath('/data/smartsecurity/nginx/../avatar.conf'), BadRequestException);
    assert.throws(() => assertSafeRemoteConfPath('/data/smartsecurity/nginx/vhost/avatar.txt'), BadRequestException);
    assert.throws(() => assertSafeRemoteConfPath('/avatar.conf'), (error: unknown) => {
      assert.ok(error instanceof BadRequestException);
      return true;
    });
  });

  it('requires a single-line restart command of reasonable length', () => {
    assert.equal(assertRestartCommand('  docker restart nginx  '), 'docker restart nginx');
    assert.throws(() => assertRestartCommand(''), BadRequestException);
    assert.throws(() => assertRestartCommand('docker restart nginx\nsystemctl stop sshd'), BadRequestException);
    assert.throws(() => assertRestartCommand('x'.repeat(501)), BadRequestException);
  });

});
