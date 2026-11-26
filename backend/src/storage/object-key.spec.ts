import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  ARCHIVE_ROOT,
  DEPLOY_ROOT,
  assertArchiveObjectKey,
  assertDeployObjectKey,
  buildArchiveCaObjectKey,
  buildArchiveCertObjectKey,
  buildArchiveCertPrefix,
  buildDeployObjectKey,
  buildDeployObjectPrefix,
  classifyStorageKind,
  buildNginxServiceObjectKey,
  buildNginxReleaseObjectKey,
  normalizeDeployPath,
} from './object-key';

const CA_ID = '11111111-1111-4111-8111-111111111111';
const CERT_ID = '22222222-2222-4222-8222-222222222222';

describe('object-key', () => {
  it('builds archive keys for a root CA public certificate', () => {
    assert.equal(
      buildArchiveCaObjectKey(CA_ID, 'rootCA.crt'),
      `${ARCHIVE_ROOT}/cas/${CA_ID}/rootCA.crt`,
    );
    assert.equal(
      buildArchiveCertPrefix(CA_ID, CERT_ID),
      `${ARCHIVE_ROOT}/certs/${CA_ID}/${CERT_ID}`,
    );
    assert.equal(
      buildArchiveCertObjectKey(CA_ID, CERT_ID, '192.168.99.242.crt'),
      `${ARCHIVE_ROOT}/certs/${CA_ID}/${CERT_ID}/192.168.99.242.crt`,
    );
    assert.equal(
      buildArchiveCertObjectKey(CA_ID, CERT_ID, '192.168.99.242.key'),
      `${ARCHIVE_ROOT}/certs/${CA_ID}/${CERT_ID}/192.168.99.242.key`,
    );
  });

  it('builds deploy keys under deploy/<server>/<path> and never mixes with archive', () => {
    assert.equal(buildDeployObjectPrefix('web-01', '/etc/nginx/ssl'), 'deploy/web-01/etc/nginx/ssl');
    assert.equal(
      buildDeployObjectKey('web-01', '/etc/nginx/ssl', 'server.crt'),
      'deploy/web-01/etc/nginx/ssl/server.crt',
    );
    assert.equal(buildDeployObjectPrefix('web-01', 'cert'), 'deploy/web-01/cert');
    assert.equal(classifyStorageKind('archive/cas/' + CA_ID + '/rootCA.crt'), 'archive');
    assert.equal(classifyStorageKind('deploy/web-01/cert/server.crt'), 'deploy');
    assert.notEqual(
      buildArchiveCertObjectKey(CA_ID, CERT_ID, 'server.crt').startsWith(`${DEPLOY_ROOT}/`),
      true,
    );
    assert.notEqual(buildDeployObjectKey('web-01', 'cert', 'server.crt').startsWith(`${ARCHIVE_ROOT}/`), true);
  });

  it('normalizes Windows deploy paths', () => {
    assert.equal(normalizeDeployPath('E:\\nginx\\ssl'), 'E/nginx/ssl');
    assert.equal(
      buildDeployObjectKey('app-server', 'E:\\nginx\\ssl', 'server.key'),
      'deploy/app-server/E/nginx/ssl/server.key',
    );
  });

  it('never builds an object key for rootCA.key in either store', () => {
    assert.throws(
      () => buildArchiveCaObjectKey(CA_ID, 'rootCA.key'),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.throws(
      () => buildArchiveCertObjectKey(CA_ID, CERT_ID, 'rootCA.key'),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.throws(
      () => buildDeployObjectKey('web-01', '/etc/nginx/ssl', 'rootCA.key'),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.throws(
      () => assertArchiveObjectKey(`archive/cas/${CA_ID}/rootCA.key`),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('rejects mixing prefixes and invalid identifiers', () => {
    assert.throws(
      () => assertDeployObjectKey(`archive/cas/${CA_ID}/rootCA.crt`),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.throws(
      () => assertArchiveObjectKey('deploy/web-01/cert/server.crt'),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.throws(
      () => classifyStorageKind('web-01/etc/nginx/ssl/server.crt'),
      (error: unknown) => error instanceof BadRequestException,
    );
    assert.throws(
      () => buildArchiveCaObjectKey('not-a-uuid', 'rootCA.crt'),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('builds nginx management-copy keys under nginx/services', () => {
    const serviceId = '33333333-3333-4333-8333-333333333333';
    const releaseId = '44444444-4444-4444-8444-444444444444';
    assert.equal(buildNginxServiceObjectKey(serviceId, 'avatar.conf'), `nginx/services/${serviceId}/avatar.conf`);
    assert.equal(
      buildNginxReleaseObjectKey(serviceId, releaseId, 'avatar-1.0.0.conf'),
      `nginx/services/${serviceId}/releases/${releaseId}/avatar-1.0.0.conf`,
    );
    assert.equal(classifyStorageKind(`nginx/services/${serviceId}/avatar.conf`), 'nginx');
  });

});
