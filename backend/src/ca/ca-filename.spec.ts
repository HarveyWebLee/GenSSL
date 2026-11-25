import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import {
  buildContentDisposition,
  buildDefaultPublicFileName,
  changeFormat,
  normalizePublicFileName,
  resolveCreatedPublicFileName,
  resolveDownloadFileName,
  toAsciiFileName,
} from './ca-filename';

describe('ca-filename', () => {
  it('builds a default name from commonName, then organization-Root-CA', () => {
    assert.equal(
      buildDefaultPublicFileName({
        commonName: 'MyCompany Local Root CA',
        organization: 'MyCompany',
      }),
      'MyCompany-Local-Root-CA.crt',
    );

    assert.equal(
      buildDefaultPublicFileName({ organization: 'Acme' }),
      'Acme-Root-CA.crt',
    );

    assert.equal(buildDefaultPublicFileName({}), 'Root-CA.crt');

    assert.equal(
      buildDefaultPublicFileName({ commonName: '  ...  ', organization: 'Demo Org' }),
      'Demo-Org-Root-CA.crt',
    );
  });

  it('uses a custom public file name and appends .crt when missing', () => {
    assert.equal(
      resolveCreatedPublicFileName('公司根证书', { commonName: 'Ignored' }),
      '公司根证书.crt',
    );
    assert.equal(
      resolveCreatedPublicFileName('Custom-CA.cer', { commonName: 'Ignored' }),
      'Custom-CA.cer',
    );
  });

  it('sanitizes Windows-illegal characters but keeps a usable name', () => {
    assert.equal(normalizePublicFileName('My:CA*Name?.crt'), 'My-CA-Name.crt');
  });

  it('switches only the download format and keeps the same PEM stem', () => {
    assert.equal(changeFormat('MyCompany-Local-Root-CA.crt', 'cer'), 'MyCompany-Local-Root-CA.cer');
    assert.equal(changeFormat('MyCompany-Local-Root-CA.crt', 'pem'), 'MyCompany-Local-Root-CA.pem');

    const fromStored = resolveDownloadFileName({
      storedName: 'MyCompany-Local-Root-CA.crt',
      format: 'cer',
    });
    assert.equal(fromStored.filename, 'MyCompany-Local-Root-CA.cer');
    assert.equal(fromStored.format, 'cer');
  });

  it('applies a one-off filename and format query on download', () => {
    const result = resolveDownloadFileName({
      storedName: 'MyCompany-Local-Root-CA.crt',
      filename: 'Lan-Root',
      format: 'pem',
    });
    assert.equal(result.filename, 'Lan-Root.pem');
    assert.equal(result.format, 'pem');
  });

  it('rejects path traversal, separators and illegal extensions', () => {
    const rejected = [
      '../rootCA.key',
      '..\\..\\rootCA.key',
      'foo/bar.crt',
      'foo\\bar.crt',
      'secret.key',
      'payload.exe',
      '..',
      '..crt',
    ];

    for (const filename of rejected) {
      assert.throws(
        () => normalizePublicFileName(filename),
        (error: unknown) => error instanceof BadRequestException,
        `expected to reject ${filename}`,
      );
      assert.throws(
        () =>
          resolveDownloadFileName({
            storedName: 'Root-CA.crt',
            filename,
          }),
        (error: unknown) => error instanceof BadRequestException,
        `expected download to reject ${filename}`,
      );
    }

    assert.throws(
      () =>
        resolveDownloadFileName({
          storedName: 'Root-CA.crt',
          format: 'key',
        }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('emits filename and RFC 5987 filename* when the name contains Chinese', () => {
    const header = buildContentDisposition('公司根证书.crt');
    assert.match(header, /attachment; filename="Root-CA.crt"/);
    assert.match(header, /filename\*=UTF-8''/);
    assert.ok(header.includes(encodeURIComponent('公司根证书.crt')));
    assert.equal(toAsciiFileName('公司根证书.crt'), 'Root-CA.crt');

    const asciiHeader = buildContentDisposition('MyCompany-Local-Root-CA.crt');
    assert.equal(asciiHeader, 'attachment; filename="MyCompany-Local-Root-CA.crt"');
    assert.equal(asciiHeader.includes('filename*'), false);
  });
});
