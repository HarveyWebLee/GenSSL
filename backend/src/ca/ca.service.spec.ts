import assert from 'node:assert/strict';
import { after, describe, it } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as forge from 'node-forge';
import { createMemoryRepository } from '../testing/memory-repo';
import { IssuedCertificateEntity } from '../certs/issued-certificate.entity';
import { CaService } from './ca.service';
import { RootCaEntity } from './root-ca.entity';

describe('CaService (multi-root, database only)', () => {
  const repos: Array<{ items: unknown[] }> = [];

  function createService() {
    const cas = createMemoryRepository<RootCaEntity>();
    const certs = createMemoryRepository<IssuedCertificateEntity>();
    repos.push(cas, certs);
    const service = new CaService(cas as never, certs as never);
    return { service, cas, certs };
  }

  after(() => {
    for (const repo of repos) {
      repo.items.length = 0;
    }
  });

  it('creates a root CA with CA:TRUE and stores the private key only on the entity', async () => {
    const { service, cas } = createService();
    const before = Date.now();
    const details = await service.create({
      name: 'Test-Root-CA',
      country: 'cn',
      stateOrProvince: 'Guangdong',
      locality: 'Shenzhen',
      organization: 'TestOrg',
      organizationalUnit: 'QA',
      commonName: 'Test Local Root CA',
      emailAddress: 'ca@example.com',
      keySize: 2048,
      days: 30,
      hashAlgorithm: 'sha256',
      pathLenConstraint: 0,
    });

    assert.equal(details.name, 'Test-Root-CA');
    assert.equal(details.isCA, true);
    assert.equal(details.status, 'active');
    assert.equal(details.subject.country, 'CN');
    assert.equal(details.subject.commonName, 'Test Local Root CA');
    assert.equal(details.subject.organization, 'TestOrg');
    assert.deepEqual(details.issuer, details.subject);
    assert.ok(details.keyUsage.includes('keyCertSign'));
    assert.ok(details.keyUsage.includes('cRLSign'));
    assert.equal(details.pathLenConstraint, 0);
    assert.equal(details.publicKeyAlgorithm, 'RSA');
    assert.equal(details.publicKeyBits, 2048);
    assert.equal(details.signatureAlgorithm, 'sha256WithRSAEncryption');
    assert.match(details.fingerprintSha256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    assert.ok(details.serialNumber.length >= 8);

    const serialized = JSON.stringify(details);
    assert.equal(serialized.includes('BEGIN'), false);
    assert.equal(serialized.includes('PRIVATE KEY'), false);
    assert.equal(serialized.includes('privateKeyPem'), false);
    assert.equal(serialized.includes('certificatePem'), false);

    const stored = cas.items[0]!;
    assert.ok(stored.privateKeyPem.includes('PRIVATE KEY'));
    assert.ok(stored.certificatePem.includes('BEGIN CERTIFICATE'));
    assert.equal(stored.certificatePem.includes('PRIVATE KEY'), false);

    const cert = forge.pki.certificateFromPem(stored.certificatePem);
    const basic = cert.getExtension('basicConstraints') as { cA?: boolean };
    assert.equal(basic?.cA, true);

    const notBefore = new Date(details.notBefore).getTime();
    const notAfter = new Date(details.notAfter).getTime();
    assert.ok(Math.abs(notBefore - before) < 30_000);
    assert.ok(Math.abs(notAfter - notBefore - 30 * 24 * 60 * 60 * 1000) < 1000);
  });

  it('uses the management name as commonName when CN is omitted', async () => {
    const { service } = createService();
    const details = await service.create({ name: 'Lan-Root-CA', keySize: 2048 });
    assert.equal(details.subject.commonName, 'Lan-Root-CA');
    assert.equal(details.publicFileName, 'Lan-Root-CA.crt');
    assert.equal(details.subject.country, 'CN');
  });

  it('allows multiple roots and rejects a duplicate management name', async () => {
    const { service } = createService();
    const first = await service.create({ name: 'Root-A', keySize: 2048, commonName: 'First Root CA' });
    const second = await service.create({ name: 'Root-B', keySize: 2048, commonName: 'Second Root CA' });
    assert.notEqual(first.id, second.id);
    assert.notEqual(first.serialNumber, second.serialNumber);

    const listed = await service.list();
    assert.equal(listed.items.length, 2);
    assert.equal(listed.activeCount, 2);
    assert.equal(listed.retiredCount, 0);

    await assert.rejects(
      () => service.create({ name: 'Root-A', keySize: 2048 }),
      (error: unknown) => error instanceof ConflictException,
    );
  });

  it('downloads the public certificate and never exposes the private key', async () => {
    const { service, cas } = createService();
    const created = await service.create({
      name: 'Download-CA',
      keySize: 2048,
      publicFileName: '公司根证书',
    });
    const { stream, filename, contentType, contentDisposition } = await service.openCertificateFile(created.id, {
      format: 'cer',
    });
    assert.equal(filename, '公司根证书.cer');
    assert.equal(contentType, 'application/x-x509-ca-cert');
    assert.match(contentDisposition, /filename\*=UTF-8''/);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    assert.ok(body.includes('BEGIN CERTIFICATE'));
    assert.equal(body.includes('PRIVATE KEY'), false);
    assert.equal(body, cas.items[0]!.certificatePem);
  });

  it('rejects illegal download names without leaking the private key', async () => {
    const { service } = createService();
    const created = await service.create({ name: 'Safe-CA', keySize: 2048, publicFileName: 'Safe-CA.crt' });
    await assert.rejects(
      () => service.openCertificateFile(created.id, { filename: '../rootCA.key' }),
      (error: unknown) => error instanceof BadRequestException,
    );
    await assert.rejects(
      () => service.openCertificateFile(created.id, { filename: 'secret.key' }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('refuses to download or sign when the root does not exist', async () => {
    const { service } = createService();
    await assert.rejects(
      () => service.openCertificateFile('11111111-1111-4111-8111-111111111111'),
      (error: unknown) => error instanceof NotFoundException,
    );
  });

  it('retires a root without deleting its private key or history, and blocks further issuance', async () => {
    const { service, cas, certs } = createService();
    const created = await service.create({ name: 'Rotate-CA', keySize: 2048 });
    certs.items.push({
      id: '22222222-2222-4222-8222-222222222222',
      caId: created.id,
      name: 'web',
      commonName: '192.168.99.242',
      ips: ['192.168.99.242'],
      dnsNames: [],
      days: 397,
      notBefore: new Date('2026-01-01T00:00:00.000Z'),
      notAfter: new Date('2027-01-01T00:00:00.000Z'),
      serialNumber: 'aa',
      fingerprintSha256: 'FF',
      signatureAlgorithm: 'sha256WithRSAEncryption',
      publicKeyBits: 2048,
      subject: {},
      publicFileName: 'web.crt',
      keyFileName: 'web.key',
      sanDisplay: 'Subject Alternative Name:\n    IP Address: 192.168.99.242',
      certificatePem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
      archiveObjectPrefix: null,
      archiveCertObjectKey: null,
      archiveKeyObjectKey: null,
      archiveUploadedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as IssuedCertificateEntity);

    const retired = await service.retire(created.id);
    assert.equal(retired.status, 'retired');
    assert.ok(retired.retiredAt);
    assert.equal(retired.needsReissueCount, 1);
    assert.equal(retired.validCertificateCount, 0);
    assert.ok(cas.items[0]!.privateKeyPem.includes('PRIVATE KEY'));
    assert.equal(cas.items.length, 1);
    assert.equal(certs.items.length, 1);

    await assert.rejects(
      () => service.loadSigningMaterial(created.id),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('regenerates and overwrites the same root, keeps it active, and marks prior child certs as needing regenerate', async () => {
    const { service, cas, certs } = createService();
    const created = await service.create({
      name: 'Rotate-In-Place',
      keySize: 2048,
      organization: 'Lan',
      days: 30,
    });
    const previousSerial = created.serialNumber;
    const previousFingerprint = created.fingerprintSha256;
    const previousPem = cas.items[0]!.certificatePem;
    const previousKey = cas.items[0]!.privateKeyPem;

    certs.items.push({
      id: '33333333-3333-4333-8333-333333333333',
      caId: created.id,
      name: 'app',
      commonName: '192.168.99.242',
      ips: ['192.168.99.242'],
      dnsNames: [],
      days: 397,
      notBefore: new Date('2026-01-01T00:00:00.000Z'),
      notAfter: new Date('2027-01-01T00:00:00.000Z'),
      serialNumber: 'bb',
      fingerprintSha256: 'EE',
      signatureAlgorithm: 'sha256WithRSAEncryption',
      publicKeyBits: 2048,
      subject: {},
      publicFileName: 'app.crt',
      keyFileName: 'app.key',
      sanDisplay: 'Subject Alternative Name:\n    IP Address: 192.168.99.242',
      caGeneration: 1,
      issuerFingerprintSha256: previousFingerprint,
      certificatePem: '-----BEGIN CERTIFICATE-----\nMIIB\n-----END CERTIFICATE-----\n',
      archiveObjectPrefix: `archive/certs/${created.id}/33333333-3333-4333-8333-333333333333/`,
      archiveCertObjectKey: `archive/certs/${created.id}/33333333-3333-4333-8333-333333333333/app.crt`,
      archiveKeyObjectKey: `archive/certs/${created.id}/33333333-3333-4333-8333-333333333333/app.key`,
      archiveUploadedAt: new Date(),
      createdAt: new Date(),
      updatedAt: new Date(),
    } as unknown as IssuedCertificateEntity);

    const overwritten = await service.regenerate(created.id, { days: 40, keySize: 2048 });
    assert.equal(overwritten.id, created.id);
    assert.equal(overwritten.name, 'Rotate-In-Place');
    assert.equal(overwritten.status, 'active');
    assert.equal(overwritten.retiredAt, null);
    assert.equal(overwritten.generation, 2);
    assert.ok(overwritten.regeneratedAt);
    assert.notEqual(overwritten.serialNumber, previousSerial);
    assert.notEqual(overwritten.fingerprintSha256, previousFingerprint);
    assert.equal(overwritten.needsRegenerateCount, 1);
    assert.equal(overwritten.needsReissueCount, 0);
    assert.equal(overwritten.validCertificateCount, 0);
    assert.equal(overwritten.subject.organization, 'Lan');

    assert.equal(cas.items.length, 1);
    assert.notEqual(cas.items[0]!.certificatePem, previousPem);
    assert.notEqual(cas.items[0]!.privateKeyPem, previousKey);
    assert.ok(cas.items[0]!.privateKeyPem.includes('PRIVATE KEY'));
    assert.equal(cas.items[0]!.certificatePem.includes('PRIVATE KEY'), false);
    assert.equal(JSON.stringify(overwritten).includes('PRIVATE KEY'), false);
    assert.equal(certs.items.length, 1);

  });

  it('refuses to regenerate a retired root', async () => {
    const { service } = createService();
    const created = await service.create({ name: 'Retired-CA', keySize: 2048 });
    await service.retire(created.id);
    await assert.rejects(
      () => service.regenerate(created.id),
      (error: unknown) => error instanceof BadRequestException,
    );
  });
});
