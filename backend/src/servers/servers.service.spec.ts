import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import { SshCryptoService } from '../ssh/ssh-crypto';
import { MemorySshClientFactory, MemorySshWorld } from '../ssh/memory-ssh';
import { SshService } from '../ssh/ssh.service';
import { createMemoryRepository } from '../testing/memory-repo';
import { ServerPathEntity } from './entities/server-path.entity';
import { ServerEntity } from './entities/server.entity';
import { ServersService } from './servers.service';

function testConfig() {
  return {
    get(key: string) {
      if (key === 'GENSSL_SSH_CREDENTIAL_KEY') {
        return '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
      }
      return 'test';
    },
  } as ConfigService;
}

describe('ServersService SSH credentials', () => {
  async function setup() {
    const servers = createMemoryRepository<ServerEntity>();
    const paths = createMemoryRepository<ServerPathEntity>();
    const crypto = new SshCryptoService(testConfig());
    const world = new MemorySshWorld();
    world.expectedUsername = 'nginx';
    world.expectedPassword = 's3cret';
    world.addDirectory('/etc/nginx/ssl');
    const ssh = new SshService(new MemorySshClientFactory(world));
    const service = new ServersService(servers as never, paths as never, crypto, ssh);
    return { service, servers, paths, world };
  }

  it('does not return passwords, private keys or ciphertext in list/get responses', async () => {
    const { service, servers } = await setup();
    const created = await service.create({
      name: 'web-01',
      host: '192.168.99.242',
      sshUsername: 'nginx',
      sshPassword: 's3cret',
      sshPrivateKey: '-----BEGIN OPENSSH PRIVATE KEY-----\nfake\n-----END OPENSSH PRIVATE KEY-----',
      sshPassphrase: 'key-pass-xyz',
      sshAuthMethod: 'password',
    });

    assert.equal(created.hasPassword, true);
    assert.equal(created.hasPrivateKey, true);
    assert.equal(created.hasPassphrase, true);
    assert.equal(created.sshReady, true);
    assert.equal(created.sshUsername, 'nginx');

    const listed = await service.list();
    const fetched = await service.get(created.id);
    for (const payload of [created, listed, fetched]) {
      const raw = JSON.stringify(payload);
      assert.equal(raw.includes('s3cret'), false);
      assert.equal(raw.includes('BEGIN OPENSSH'), false);
      assert.equal(raw.includes('key-pass-xyz'), false);
      assert.equal(raw.includes('"sshPassword"'), false);
      assert.equal(raw.includes('"sshPrivateKey"'), false);
      assert.equal(raw.includes('Cipher'), false);
      assert.equal(raw.includes('sshHostKey":'), false);
    }

    const stored = servers.items[0]!;
    assert.ok(stored.sshPasswordCipher);
    assert.notEqual(stored.sshPasswordCipher, 's3cret');
    assert.ok(stored.sshPrivateKeyCipher);
    assert.notEqual(stored.sshPrivateKeyCipher.includes('BEGIN'), true);
  });

  it('keeps existing credentials when an update omits secret fields, and can clear them', async () => {
    const { service, servers } = await setup();
    const created = await service.create({
      name: 'web-01',
      host: '192.168.99.242',
      sshUsername: 'nginx',
      sshPassword: 's3cret',
    });
    const before = servers.items[0]!.sshPasswordCipher;
    const updated = await service.update(created.id, { sshPort: 2222, sshUsername: 'deploy' });
    assert.equal(updated.sshPort, 2222);
    assert.equal(updated.sshUsername, 'deploy');
    assert.equal(updated.hasPassword, true);
    assert.equal(servers.items[0]!.sshPasswordCipher, before);

    const cleared = await service.update(created.id, { clearSshCredentials: true });
    assert.equal(cleared.hasPassword, false);
    assert.equal(cleared.sshReady, false);
    assert.match(cleared.sshReadyReason ?? '', /SSH 密码/);
    assert.equal(servers.items[0]!.sshPasswordCipher, null);
  });

  it('tests SSH login against a fake SFTP server without uploading certificates', async () => {
    const { service, paths, world } = await setup();
    const created = await service.create({
      name: 'web-01',
      host: '192.168.99.242',
      sshUsername: 'nginx',
      sshPassword: 's3cret',
    });
    await service.addPath(created.id, { path: '/etc/nginx/ssl' });
    const pathId = paths.items[0]!.id;
    const result = await service.testConnection({ pathId }, created.id);
    assert.equal(result.ok, true);
    assert.equal(result.pathExists, true);
    assert.equal(result.hostKeyNewlyTrusted, true);
    assert.match(result.message, /已记录并锁定/);
    assert.equal(world.files.size, 0);

    const fetched = await service.get(created.id);
    assert.equal(fetched.sshHostKeyPinned, true);
    assert.ok(fetched.sshHostKeyFingerprint);
    assert.equal(JSON.stringify(fetched).includes('s3cret'), false);
  });
});
