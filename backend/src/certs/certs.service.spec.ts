import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException, ServiceUnavailableException } from '@nestjs/common';
import * as forge from 'node-forge';
import { ArchiveService } from '../archive/archive.service';
import { CaService } from '../ca/ca.service';
import { RootCaEntity } from '../ca/root-ca.entity';
import { createMemoryRepository } from '../testing/memory-repo';
import { MemoryRustfsService } from '../testing/memory-rustfs';
import { IssuedCertificateEntity } from './issued-certificate.entity';
import { CertsService } from './certs.service';
import { readSanFromCert } from './san';

async function setup() {
  const cas = createMemoryRepository<RootCaEntity>();
  const certs = createMemoryRepository<IssuedCertificateEntity>();
  const rustfs = new MemoryRustfsService();
  const archive = new ArchiveService(rustfs as never);
  const caService = new CaService(cas as never, certs as never, archive);
  const certsService = new CertsService(caService, archive, certs as never);
  const root = await caService.create({ name: 'Lan-Root-CA', keySize: 2048, organization: 'Lan' });
  return { cas, certs, caService, rustfs, archive, certsService, root };
}

describe('CertsService (multi-root, archive on RustFS)', () => {
  it('issues a server certificate under a selected active root and stores files only in the archive prefix', async () => {
    const { certsService, rustfs, root } = await setup();
    const detail = await certsService.issue({
      caId: root.id,
      ips: ['192.168.99.242', '192.168.99.243', '192.168.99.244'],
      keySize: 2048,
      days: 30,
    });

    assert.equal(detail.ca.id, root.id);
    assert.equal(detail.ca.name, 'Lan-Root-CA');
    assert.equal(detail.status, 'valid');
    assert.deepEqual(detail.ips, ['192.168.99.242', '192.168.99.243', '192.168.99.244']);
    assert.equal(
      detail.sanDisplay,
      [
        'Subject Alternative Name:',
        '    IP Address: 192.168.99.242',
        '    IP Address: 192.168.99.243',
        '    IP Address: 192.168.99.244',
      ].join('\n'),
    );
    assert.equal(detail.verification.ok, true);
    assert.equal(detail.archive.storageKind, 'archive');
    assert.ok(detail.archive.certObjectKey?.startsWith(`archive/certs/${root.id}/${detail.id}/`));
    assert.ok(detail.archive.keyObjectKey?.endsWith('.key'));

    const keys = [...rustfs.objects.keys()];
    assert.ok(keys.some((key) => key.endsWith('.crt')));
    assert.ok(keys.some((key) => key.endsWith('.key')));
    assert.equal(keys.some((key) => key.startsWith('deploy/')), false);
    assert.equal(keys.some((key) => /rootca\.key$/i.test(key)), false);
    for (const body of rustfs.objects.values()) {
      const text = body.toString('utf8');
      if (text.includes('PRIVATE KEY')) {
        assert.equal(/rootCA\.key$/i.test(keys.find((key) => rustfs.objects.get(key) === body) || ''), false);
      }
    }

    const certPem = rustfs.objects.get(detail.archive.certObjectKey as string)?.toString('utf8') ?? '';
    const cert = forge.pki.certificateFromPem(certPem);
    const parsed = readSanFromCert(cert);
    assert.equal(parsed.hasIpEncodedAsDns, false);
    assert.deepEqual(parsed.ips, detail.ips);
    const basic = cert.getExtension('basicConstraints') as { cA?: boolean };
    assert.equal(basic?.cA, false);

    const serialized = JSON.stringify(detail);
    assert.equal(serialized.includes('privateKeyPem'), false);
  });

  it('refuses to issue under a retired root, and marks existing certs as needing reissue', async () => {
    const { certsService, caService, root } = await setup();
    const issued = await certsService.issue({
      caId: root.id,
      ips: ['10.0.0.2'],
      keySize: 2048,
    });
    await caService.retire(root.id);

    const listed = await certsService.list();
    const first = listed.items[0]!;
    assert.equal(first.status, 'needs_reissue');
    assert.equal(first.statusLabel, '已失效（需重签）');
    assert.equal(first.ca.status, 'retired');
    assert.equal(first.id, issued.id);

    await assert.rejects(
      () => certsService.issue({ caId: root.id, ips: ['10.0.0.3'], keySize: 2048 }),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('requires RustFS because the server private key is stored only in the certificate library', async () => {
    const { certsService, rustfs, root } = await setup();
    rustfs.ready = false;
    rustfs.lastError = 'down';
    await assert.rejects(
      () => certsService.issue({ caId: root.id, ips: ['192.168.1.10'], keySize: 2048 }),
      (error: unknown) => error instanceof ServiceUnavailableException,
    );
    assert.equal(rustfs.objects.size, 0);
  });

  it('marks issued certificates unavailable after the root is regenerated, then restores them when they are regenerated', async () => {
    const { certsService, caService, rustfs, root } = await setup();
    const issued = await certsService.issue({
      caId: root.id,
      ips: ['192.168.99.242', '192.168.99.243'],
      keySize: 2048,
      days: 30,
    });
    const previousSerial = issued.serialNumber;
    const previousFingerprint = issued.fingerprintSha256;
    const previousCertPem = rustfs.objects.get(issued.archive.certObjectKey as string)?.toString('utf8');
    const previousKeyPem = rustfs.objects.get(issued.archive.keyObjectKey as string)?.toString('utf8');
    const rootObjectKey = `archive/cas/${root.id}/rootCA.crt`;
    const previousRootPem = rustfs.objects.get(rootObjectKey)?.toString('utf8');
    assert.ok(previousCertPem);
    assert.ok(previousKeyPem);

    const overwrittenRoot = await caService.regenerate(root.id, { days: 60, keySize: 2048 });
    assert.equal(overwrittenRoot.id, root.id);
    assert.equal(overwrittenRoot.status, 'active');
    assert.equal(overwrittenRoot.generation, 2);
    assert.equal(overwrittenRoot.needsRegenerateCount, 1);
    assert.notEqual(rustfs.objects.get(rootObjectKey)?.toString('utf8'), previousRootPem);
    assert.ok(rustfs.objects.get(rootObjectKey)?.toString('utf8')?.includes('BEGIN CERTIFICATE'));
    assert.equal([...rustfs.objects.keys()].some((key) => /rootca\.key$/i.test(key)), false);
    assert.equal([...rustfs.objects.keys()].some((key) => key.startsWith('deploy/')), false);

    const stale = (await certsService.list()).items[0]!;
    assert.equal(stale.id, issued.id);
    assert.equal(stale.status, 'needs_regenerate');
    assert.equal(stale.statusLabel, '不可用，需重新生成并覆盖');
    assert.equal(stale.unavailableReason, 'ca_regenerated');
    assert.equal(stale.ca.status, 'active');
    assert.equal(stale.caGeneration, 1);

    const restored = await certsService.regenerate(issued.id);
    assert.equal(restored.id, issued.id);
    assert.equal(restored.name, issued.name);
    assert.equal(restored.ca.id, root.id);
    assert.equal(restored.status, 'valid');
    assert.equal(restored.unavailableReason, null);
    assert.equal(restored.caGeneration, 2);
    assert.notEqual(restored.serialNumber, previousSerial);
    assert.notEqual(restored.fingerprintSha256, previousFingerprint);
    assert.deepEqual(restored.ips, ['192.168.99.242', '192.168.99.243']);
    assert.equal(restored.verification.ok, true);
    assert.match(restored.warning ?? '', /部署目录/);
    assert.equal(restored.archive.certObjectKey, issued.archive.certObjectKey);
    assert.notEqual(rustfs.objects.get(issued.archive.certObjectKey as string)?.toString('utf8'), previousCertPem);
    assert.notEqual(rustfs.objects.get(issued.archive.keyObjectKey as string)?.toString('utf8'), previousKeyPem);
    assert.equal([...rustfs.objects.keys()].some((key) => key.startsWith('deploy/')), false);
    assert.equal([...rustfs.objects.keys()].some((key) => /rootca\.key$/i.test(key)), false);
  });

  it('allows rotating a still-valid server certificate, and refuses regenerate under a retired root', async () => {
    const { certsService, caService, root } = await setup();
    const issued = await certsService.issue({
      caId: root.id,
      ips: ['10.0.0.8'],
      keySize: 2048,
    });
    const rotated = await certsService.regenerate(issued.id, { days: 20 });
    assert.equal(rotated.id, issued.id);
    assert.equal(rotated.status, 'valid');
    assert.notEqual(rotated.serialNumber, issued.serialNumber);
    assert.equal(rotated.days, 20);

    await caService.retire(root.id);
    await assert.rejects(
      () => certsService.regenerate(issued.id),
      (error: unknown) => error instanceof BadRequestException,
    );
  });

  it('batch-regenerates unavailable certificates under a regenerated root', async () => {
    const { certsService, caService, root } = await setup();
    const first = await certsService.issue({ caId: root.id, ips: ['10.0.0.2'], keySize: 2048 });
    const second = await certsService.issue({ caId: root.id, ips: ['10.0.0.3'], keySize: 2048 });
    await caService.regenerate(root.id, { keySize: 2048 });

    const result = await certsService.regenerateMany({ caId: root.id });
    assert.equal(result.failed.length, 0);
    assert.equal(result.items.length, 2);
    assert.deepEqual(result.items.map((item) => item.id).sort(), [first.id, second.id].sort());
    assert.ok(result.items.every((item) => item.status === 'valid'));
    assert.ok(result.items.every((item) => item.caGeneration === 2));
  });

  it('soft-deletes an issued certificate so lists hide it, names can be reused, and it cannot be loaded for deploy', async () => {
    const { certsService, certs, root } = await setup();
    const issued = await certsService.issue({
      caId: root.id,
      name: 'avatar',
      ips: ['10.0.0.9'],
      keySize: 2048,
    });
    const result = await certsService.softDelete(issued.id);
    assert.equal(result.ok, true);
    assert.ok(certs.items.find((item) => item.id === issued.id)?.deletedAt);
    assert.equal((await certsService.list()).items.length, 0);
    assert.equal(await certsService.count(), 0);
    await assert.rejects(() => certsService.findRecord(issued.id), (error: unknown) => error instanceof NotFoundException);
    await assert.rejects(() => certsService.getDetail(issued.id), (error: unknown) => error instanceof NotFoundException);

    const reused = await certsService.issue({
      caId: root.id,
      name: 'avatar',
      ips: ['10.0.0.9'],
      keySize: 2048,
    });
    assert.notEqual(reused.id, issued.id);
    assert.equal((await certsService.list()).items.length, 1);

    await assert.rejects(
      () => certsService.issue({ caId: root.id, name: 'avatar', ips: ['10.0.0.10'], keySize: 2048 }),
      (error: unknown) => error instanceof ConflictException,
    );
  });

  it('keeps undeleted certificates visible after the parent root is soft-deleted, but blocks signing', async () => {
    const { certsService, caService, root } = await setup();
    const issued = await certsService.issue({ caId: root.id, ips: ['10.0.0.11'], keySize: 2048 });
    await caService.softDelete(root.id);
    const listed = await certsService.list();
    assert.equal(listed.items.length, 1);
    assert.equal(listed.items[0]!.id, issued.id);
    assert.equal(listed.items[0]!.ca.deleted, true);
    await assert.rejects(
      () => certsService.regenerate(issued.id),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(String((error as BadRequestException).message), /已删除/);
        return true;
      },
    );
  });

});
