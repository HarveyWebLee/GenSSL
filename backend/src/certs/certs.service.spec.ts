import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ServiceUnavailableException } from '@nestjs/common';
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
  const caService = new CaService(cas as never, certs as never);
  const rustfs = new MemoryRustfsService();
  const archive = new ArchiveService(rustfs as never);
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
});
