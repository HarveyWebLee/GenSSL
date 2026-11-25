import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { buildObjectKey, buildObjectPrefix, normalizeDeployPath } from './object-key';

describe('object-key', () => {
  it('maps a server and nginx path to a stable prefix', () => {
    assert.equal(buildObjectPrefix('web-01', '/etc/nginx/ssl'), 'web-01/etc/nginx/ssl');
    assert.equal(
      buildObjectKey('web-01', '/etc/nginx/ssl', 'server.crt'),
      'web-01/etc/nginx/ssl/server.crt',
    );
  });

  it('normalizes Windows paths', () => {
    assert.equal(normalizeDeployPath('E:\\nginx\\ssl'), 'E/nginx/ssl');
    assert.equal(
      buildObjectKey('app-server', 'E:\\nginx\\ssl', 'server.key'),
      'app-server/E/nginx/ssl/server.key',
    );
  });

  it('never builds an object key for rootCA.key', () => {
    assert.throws(
      () => buildObjectKey('web-01', '/etc/nginx/ssl', 'rootCA.key'),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});
