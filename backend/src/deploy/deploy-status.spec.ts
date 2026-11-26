import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { resolveDeployStale } from './deploy-status';

describe('resolveDeployStale', () => {
  const deployedAt = new Date('2026-01-01T00:00:00.000Z');

  it('marks a deploy stale when the certificate fingerprint changed after upload', () => {
    const result = resolveDeployStale({
      storedFingerprint: 'AA:BB',
      currentFingerprint: 'CC:DD',
      certStatus: 'valid',
      deployedAt,
    });
    assert.deepEqual(result, {
      stale: true,
      staleReason: 'certificate_overwritten',
      staleLabel: '已过时（证书已重新生成，需重新上传）',
    });
  });

  it('marks a deploy stale when the current certificate is unavailable even if fingerprints match', () => {
    const result = resolveDeployStale({
      storedFingerprint: 'AA:BB',
      currentFingerprint: 'AA:BB',
      certStatus: 'needs_regenerate',
      deployedAt,
    });
    assert.equal(result.stale, true);
    assert.equal(result.staleReason, 'certificate_unavailable');
    assert.match(result.staleLabel ?? '', /需先重新生成并覆盖/);
  });

  it('uses updatedAt as a fallback when older records have no stored fingerprint', () => {
    const result = resolveDeployStale({
      storedFingerprint: '',
      currentFingerprint: 'AA:BB',
      certStatus: 'valid',
      deployedAt,
      certUpdatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    assert.equal(result.staleReason, 'certificate_overwritten');
  });

  it('does not treat a matching valid certificate as stale', () => {
    const result = resolveDeployStale({
      storedFingerprint: 'AA:BB',
      currentFingerprint: 'AA:BB',
      certStatus: 'valid',
      deployedAt,
      certUpdatedAt: new Date('2026-02-01T00:00:00.000Z'),
    });
    assert.deepEqual(result, { stale: false, staleReason: null, staleLabel: null });
  });
});
