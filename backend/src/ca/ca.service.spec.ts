import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, unlink, writeFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { after, describe, it } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import * as forge from 'node-forge';
import { CaService } from './ca.service';
import { CA_META_FILE } from './ca-filename';

describe('CaService', () => {
  const tempDirs: string[] = [];

  after(async () => {
    await Promise.all(
      tempDirs.map((dir) => rm(dir, { recursive: true, force: true })),
    );
  });

  async function createService(): Promise<{ service: CaService; dir: string }> {
    const dir = await mkdtemp(path.join(tmpdir(), 'genssl-ca-'));
    tempDirs.push(dir);
    return { service: new CaService(dir), dir };
  }

  it('creates a root CA with CA:TRUE, requested subject and validity', async () => {
    const { service, dir } = await createService();
    const before = Date.now();

    const details = await service.create({
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

    assert.equal(details.exists, true);
    assert.equal(details.isCA, true);
    assert.equal(details.subject.country, 'CN');
    assert.equal(details.subject.stateOrProvince, 'Guangdong');
    assert.equal(details.subject.locality, 'Shenzhen');
    assert.equal(details.subject.organization, 'TestOrg');
    assert.equal(details.subject.organizationalUnit, 'QA');
    assert.equal(details.subject.commonName, 'Test Local Root CA');
    assert.equal(details.subject.emailAddress, 'ca@example.com');
    assert.deepEqual(details.issuer, details.subject);
    assert.ok(details.keyUsage.includes('keyCertSign'));
    assert.ok(details.keyUsage.includes('cRLSign'));
    assert.equal(details.pathLenConstraint, 0);
    assert.equal(details.publicKeyAlgorithm, 'RSA');
    assert.equal(details.publicKeyBits, 2048);
    assert.equal(details.signatureAlgorithm, 'sha256WithRSAEncryption');
    assert.match(details.fingerprintSha256, /^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
    assert.notEqual(details.serialNumber, '01');
    assert.notEqual(details.serialNumber, '1');
    assert.ok(details.serialNumber.length >= 8);

    const serialized = JSON.stringify(details);
    assert.equal(serialized.includes('BEGIN'), false);
    assert.equal(serialized.includes('PRIVATE KEY'), false);
    assert.equal('privateKey' in details, false);

    const pem = await readFile(path.join(dir, 'rootCA.crt'), 'utf8');
    const cert = forge.pki.certificateFromPem(pem);
    const basic = cert.getExtension('basicConstraints') as { cA?: boolean; critical?: boolean };
    assert.equal(basic?.cA, true);

    const notBefore = new Date(details.notBefore).getTime();
    const notAfter = new Date(details.notAfter).getTime();
    assert.ok(Math.abs(notBefore - before) < 30_000);
    const expectedMs = 30 * 24 * 60 * 60 * 1000;
    assert.ok(Math.abs(notAfter - notBefore - expectedMs) < 1000);

    const status = await service.getStatus();
    assert.equal(status.exists, true);
    if (status.exists && !status.incomplete) {
      assert.equal(status.subject.commonName, 'Test Local Root CA');
    }
  });

  it('applies document defaults when optional fields are omitted', async () => {
    const { service } = await createService();
    const details = await service.create({ keySize: 2048 });

    assert.equal(details.subject.country, 'CN');
    assert.equal(details.subject.organization, 'MyCompany');
    assert.equal(details.subject.organizationalUnit, 'IT');
    assert.equal(details.subject.commonName, 'MyCompany Local Root CA');
    assert.equal(details.publicFileName, 'MyCompany-Local-Root-CA.crt');
    assert.equal(details.suggestedFileName, 'MyCompany-Local-Root-CA.crt');
    assert.equal(details.pathLenConstraint, null);

    const notBefore = new Date(details.notBefore).getTime();
    const notAfter = new Date(details.notAfter).getTime();
    assert.ok(Math.abs(notAfter - notBefore - 3650 * 24 * 60 * 60 * 1000) < 1000);
  });

  it('rejects a second create without overwrite and allows overwrite', async () => {
    const { service } = await createService();
    const first = await service.create({
      keySize: 2048,
      commonName: 'First Root CA',
    });

    await assert.rejects(
      () => service.create({ keySize: 2048, commonName: 'Second Root CA' }),
      (error: unknown) => error instanceof ConflictException,
    );

    const second = await service.create({
      keySize: 2048,
      commonName: 'Second Root CA',
      overwrite: true,
    });

    assert.equal(second.subject.commonName, 'Second Root CA');
    assert.notEqual(second.serialNumber, first.serialNumber);
  });

  it('refuses to download a certificate that has not been created', async () => {
    const { service } = await createService();
    await assert.rejects(
      () => service.openCertificateFile(),
      (error: unknown) => error instanceof NotFoundException,
    );
  });

  it('opens the certificate file after creation and never exposes the key path in download', async () => {
    const { service, dir } = await createService();
    await service.create({ keySize: 2048 });

    const { stream, filename } = await service.openCertificateFile();
    assert.equal(filename, 'MyCompany-Local-Root-CA.crt');
    assert.equal(existsSync(path.join(dir, 'rootCA.crt')), true);
    assert.equal(existsSync(path.join(dir, 'rootCA.key')), true);

    const chunks: Buffer[] = [];
    for await (const chunk of stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    assert.ok(body.includes('BEGIN CERTIFICATE'));
    assert.equal(body.includes('PRIVATE KEY'), false);

    const keyPem = await readFile(path.join(dir, 'rootCA.key'), 'utf8');
    assert.ok(keyPem.includes('PRIVATE KEY'));
  });

  it('requires overwrite when only the private key file remains', async () => {
    const { service, dir } = await createService();
    await mkdir(dir, { recursive: true });
    await writeFile(path.join(dir, 'rootCA.key'), 'dummy-key', 'utf8');

    const status = await service.getStatus();
    assert.equal(status.exists, true);
    assert.equal('incomplete' in status && status.incomplete, true);

    await assert.rejects(
      () => service.create({ keySize: 2048 }),
      (error: unknown) => error instanceof ConflictException,
    );
  });

  it('persists a custom public file name and keeps internal storage as rootCA.crt', async () => {
    const { service, dir } = await createService();
    const details = await service.create({
      keySize: 2048,
      commonName: 'Custom CN',
      organization: 'CustomOrg',
      publicFileName: '公司根证书',
    });

    assert.equal(details.publicFileName, '公司根证书.crt');
    assert.equal(details.suggestedFileName, 'Custom-CN.crt');
    assert.equal(existsSync(path.join(dir, 'rootCA.crt')), true);
    assert.equal(existsSync(path.join(dir, 'rootCA.key')), true);
    assert.equal(existsSync(path.join(dir, '公司根证书.crt')), false);

    const meta = JSON.parse(await readFile(path.join(dir, CA_META_FILE), 'utf8')) as {
      publicFileName: string;
    };
    assert.equal(meta.publicFileName, '公司根证书.crt');

    const status = await service.getStatus();
    assert.equal(status.exists, true);
    if (status.exists && !status.incomplete) {
      assert.equal(status.publicFileName, '公司根证书.crt');
    }
  });

  it('updates the public file name when overwriting the root CA', async () => {
    const { service } = await createService();
    await service.create({
      keySize: 2048,
      publicFileName: 'First-CA.crt',
    });
    const second = await service.create({
      keySize: 2048,
      commonName: 'Second Root CA',
      publicFileName: 'Second-CA.cer',
      overwrite: true,
    });
    assert.equal(second.publicFileName, 'Second-CA.cer');
  });

  it('generates a public file name from the certificate subject when metadata is missing', async () => {
    const { service, dir } = await createService();
    await service.create({
      keySize: 2048,
      commonName: 'Legacy Root CA',
      organization: 'LegacyOrg',
    });
    await unlink(path.join(dir, CA_META_FILE));

    const status = await service.getStatus();
    assert.equal(status.exists, true);
    if (status.exists && !status.incomplete) {
      assert.equal(status.publicFileName, 'Legacy-Root-CA.crt');
      assert.equal(status.suggestedFileName, 'Legacy-Root-CA.crt');
    }
  });

  it('downloads using the public name and format while never returning the private key', async () => {
    const { service, dir } = await createService();
    await service.create({
      keySize: 2048,
      publicFileName: '公司根证书',
    });

    const cer = await service.openCertificateFile({ format: 'cer' });
    assert.equal(cer.filename, '公司根证书.cer');
    assert.equal(cer.contentType, 'application/x-x509-ca-cert');
    assert.match(cer.contentDisposition, /filename="Root-CA.cer"/);
    assert.match(cer.contentDisposition, /filename\*=UTF-8''/);

    const pem = await service.openCertificateFile({
      filename: 'Lan-HTTPS-Root',
      format: 'pem',
    });
    assert.equal(pem.filename, 'Lan-HTTPS-Root.pem');
    assert.equal(pem.contentType, 'application/x-pem-file');

    const chunks: Buffer[] = [];
    for await (const chunk of pem.stream) {
      chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    }
    const body = Buffer.concat(chunks).toString('utf8');
    assert.ok(body.includes('BEGIN CERTIFICATE'));
    assert.equal(body.includes('PRIVATE KEY'), false);

    const storedCert = await readFile(path.join(dir, 'rootCA.crt'), 'utf8');
    assert.equal(body, storedCert);
    const keyPem = await readFile(path.join(dir, 'rootCA.key'), 'utf8');
    assert.ok(keyPem.includes('PRIVATE KEY'));
    assert.notEqual(body, keyPem);
  });

  it('rejects illegal download names and traversal without touching the private key', async () => {
    const { service, dir } = await createService();
    await service.create({ keySize: 2048, publicFileName: 'Safe-CA.crt' });

    await assert.rejects(
      () => service.openCertificateFile({ filename: '../rootCA.key' }),
      (error: unknown) => error instanceof BadRequestException,
    );
    await assert.rejects(
      () => service.openCertificateFile({ filename: '..\\..\\rootCA.key' }),
      (error: unknown) => error instanceof BadRequestException,
    );
    await assert.rejects(
      () => service.openCertificateFile({ filename: 'secret.key' }),
      (error: unknown) => error instanceof BadRequestException,
    );

    const keyPath = path.join(dir, 'rootCA.key');
    assert.equal(existsSync(keyPath), true);
  });


});
