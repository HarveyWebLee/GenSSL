import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { describeSshReadiness } from './ssh-readiness';

describe('describeSshReadiness', () => {
  it('requires host, username and the credential for the selected auth method', () => {
    const missingAll = describeSshReadiness({});
    assert.equal(missingAll.ready, false);
    assert.match(missingAll.reason ?? '', /主机地址/);
    assert.match(missingAll.reason ?? '', /SSH 用户名/);
    assert.match(missingAll.reason ?? '', /SSH 密码/);

    const missingKey = describeSshReadiness({
      host: '192.168.99.242',
      sshUsername: 'root',
      sshAuthMethod: 'privateKey',
      hasPassword: true,
    });
    assert.equal(missingKey.ready, false);
    assert.match(missingKey.reason ?? '', /SSH 私钥/);

    const ready = describeSshReadiness({
      host: '192.168.99.242',
      sshUsername: 'root',
      sshAuthMethod: 'password',
      hasPassword: true,
    });
    assert.deepEqual(ready, { ready: true, missing: [], reason: null });
  });
});
