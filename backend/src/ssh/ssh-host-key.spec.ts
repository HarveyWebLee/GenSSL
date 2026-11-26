import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConflictException } from '@nestjs/common';
import { decideHostKey, fingerprintSha256, parseHostKeyInfo } from './ssh-host-key';

function fakeKey(algo: string, payload: string): Buffer {
  const algoBuf = Buffer.from(algo, 'ascii');
  const body = Buffer.from(payload);
  const header = Buffer.alloc(4);
  header.writeUInt32BE(algoBuf.length);
  return Buffer.concat([header, algoBuf, body]);
}

describe('host key pinning', () => {
  it('parses the algorithm and OpenSSH-style SHA256 fingerprint', () => {
    const raw = fakeKey('ssh-ed25519', 'abc');
    const info = parseHostKeyInfo(raw);
    assert.equal(info.algorithm, 'ssh-ed25519');
    assert.equal(info.fingerprint, fingerprintSha256(raw));
    assert.equal(info.fingerprint.startsWith('SHA256:'), true);
  });

  it('accepts an unknown host key on first use and later rejects a mismatch', () => {
    const first = parseHostKeyInfo(fakeKey('ssh-ed25519', 'one'));
    const second = parseHostKeyInfo(fakeKey('ssh-ed25519', 'two'));
    const initial = decideHostKey({ peer: first });
    assert.equal(initial.accept, true);
    assert.equal(initial.newlyTrusted, true);

    const same = decideHostKey({ pinned: first, peer: first });
    assert.equal(same.newlyTrusted, false);

    assert.throws(() => decideHostKey({ pinned: first, peer: second }), (error: unknown) => {
      assert.ok(error instanceof ConflictException);
      assert.match(String((error as ConflictException).message), /主机密钥与已锁定的指纹不一致/);
      return true;
    });

    const trusted = decideHostKey({ pinned: first, peer: second, trustNewHostKey: true });
    assert.equal(trusted.newlyTrusted, true);
    assert.equal(trusted.peer.fingerprint, second.fingerprint);
  });
});
