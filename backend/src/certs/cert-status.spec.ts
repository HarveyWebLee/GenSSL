import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { computeCertificateStatus } from './cert-status';

describe('computeCertificateStatus', () => {
  const now = new Date('2026-06-01T00:00:00.000Z');
  const notBefore = new Date('2026-01-01T00:00:00.000Z');
  const notAfter = new Date('2026-12-31T00:00:00.000Z');

  it('marks certificates of a retired root as needing reissue even if still in period', () => {
    assert.equal(
      computeCertificateStatus({ caStatus: 'retired', notBefore, notAfter, now }),
      'needs_reissue',
    );
  });

  it('returns valid / expired / not_yet_valid for an active root', () => {
    assert.equal(
      computeCertificateStatus({ caStatus: 'active', notBefore, notAfter, now }),
      'valid',
    );
    assert.equal(
      computeCertificateStatus({
        caStatus: 'active',
        notBefore,
        notAfter,
        now: new Date('2027-01-01T00:00:00.000Z'),
      }),
      'expired',
    );
    assert.equal(
      computeCertificateStatus({
        caStatus: 'active',
        notBefore,
        notAfter,
        now: new Date('2025-12-01T00:00:00.000Z'),
      }),
      'not_yet_valid',
    );
  });

  it('marks certificates of a regenerated root as needs_regenerate even if still in period', () => {
    assert.equal(
      computeCertificateStatus({
        caStatus: 'active',
        caGeneration: 2,
        certCaGeneration: 1,
        notBefore,
        notAfter,
        now,
      }),
      'needs_regenerate',
    );
  });

  it('gives regenerated-root unavailability priority over expired and not-yet-valid', () => {
    assert.equal(
      computeCertificateStatus({
        caStatus: 'active',
        caGeneration: 2,
        certCaGeneration: 1,
        notBefore,
        notAfter,
        now: new Date('2027-01-01T00:00:00.000Z'),
      }),
      'needs_regenerate',
    );
    assert.equal(
      computeCertificateStatus({
        caStatus: 'active',
        caGeneration: 2,
        certCaGeneration: 1,
        issuerFingerprintSha256: 'AA',
        caFingerprintSha256: 'BB',
        notBefore,
        notAfter,
        now: new Date('2025-12-01T00:00:00.000Z'),
      }),
      'needs_regenerate',
    );
  });

  it('treats a retired root as needs_reissue even if the certificate generation is also stale', () => {
    assert.equal(
      computeCertificateStatus({
        caStatus: 'retired',
        caGeneration: 2,
        certCaGeneration: 1,
        notBefore,
        notAfter,
        now,
      }),
      'needs_reissue',
    );
  });

  it('returns valid when the certificate matches the current active root generation', () => {
    assert.equal(
      computeCertificateStatus({
        caStatus: 'active',
        caGeneration: 2,
        certCaGeneration: 2,
        issuerFingerprintSha256: 'AA',
        caFingerprintSha256: 'AA',
        notBefore,
        notAfter,
        now,
      }),
      'valid',
    );
  });
});
