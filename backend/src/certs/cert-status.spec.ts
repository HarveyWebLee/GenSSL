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
});
