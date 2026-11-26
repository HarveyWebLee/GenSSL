import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ArchiveService } from '../archive/archive.service';
import { CaService } from '../ca/ca.service';
import { RootCaEntity } from '../ca/root-ca.entity';
import { IssuedCertificateEntity } from '../certs/issued-certificate.entity';
import { createMemoryRepository } from '../testing/memory-repo';
import { MemoryRustfsService } from '../testing/memory-rustfs';
import { GuidesService } from './guides.service';

describe('GuidesService', () => {
  it('adds a first-class reinstall warning after the selected root is regenerated', async () => {
    const cas = createMemoryRepository<RootCaEntity>();
    const certs = createMemoryRepository<IssuedCertificateEntity>();
    const rustfs = new MemoryRustfsService();
    const archive = new ArchiveService(rustfs as never);
    const caService = new CaService(cas as never, certs as never, archive);
    const guides = new GuidesService(caService);

    const created = await caService.create({ name: 'Lan-Root-CA', keySize: 2048 });
    const before = await guides.getWindowsTrustGuide(created.id);
    assert.equal(before.selectedCa?.wasRegenerated, false);
    assert.equal(before.warning.includes('已被重新生成并覆盖'), false);

    await caService.regenerate(created.id, { keySize: 2048 });
    const after = await guides.getWindowsTrustGuide(created.id);
    assert.equal(after.selectedCa?.wasRegenerated, true);
    assert.equal(after.selectedCa?.generation, 2);
    assert.match(after.warning, /已被重新生成并覆盖/);
    assert.ok(after.steps.some((step) => step.includes('必须改装这次下载的新公钥')));
  });
});
