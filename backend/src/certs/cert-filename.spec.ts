import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  deriveServerKeyFileName,
  resolveServerCertPublicFileName,
  resolveServerKeyDownloadName,
} from './cert-filename';

describe('server cert public file names', () => {
  it('builds a default name from the first IP or CN and derives the key name', () => {
    const certName = resolveServerCertPublicFileName(undefined, {
      firstIp: '192.168.99.242',
    });
    assert.equal(certName, '192.168.99.242.crt');
    assert.equal(deriveServerKeyFileName(certName), '192.168.99.242.key');
  });

  it('keeps a custom public name and switches key extension independently', () => {
    const certName = resolveServerCertPublicFileName('Lan-Web.pem', {
      firstIp: '10.0.0.1',
    });
    assert.equal(certName, 'Lan-Web.pem');
    assert.equal(deriveServerKeyFileName(certName), 'Lan-Web.key');
  });

  it('rejects naming a private key rootCA.key', () => {
    assert.throws(
      () => resolveServerKeyDownloadName({ storedKeyName: 'server.key', filename: 'rootCA.key' }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});
