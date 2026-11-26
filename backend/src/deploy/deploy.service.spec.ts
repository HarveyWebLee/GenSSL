import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ArchiveService } from '../archive/archive.service';
import { CaService } from '../ca/ca.service';
import { RootCaEntity } from '../ca/root-ca.entity';
import { CertsService } from '../certs/certs.service';
import { IssuedCertificateEntity } from '../certs/issued-certificate.entity';
import { ServersService } from '../servers/servers.service';
import { ServerEntity } from '../servers/entities/server.entity';
import { ServerPathEntity } from '../servers/entities/server-path.entity';
import { SshCryptoService } from '../ssh/ssh-crypto';
import { MemorySshClientFactory, MemorySshWorld } from '../ssh/memory-ssh';
import { SshService } from '../ssh/ssh.service';
import { joinRemoteFile } from '../ssh/ssh-path';
import { createMemoryRepository } from '../testing/memory-repo';
import { MemoryRustfsService } from '../testing/memory-rustfs';
import { DeployRecordEntity } from './deploy-record.entity';
import { DeployService } from './deploy.service';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';

function testConfig() {
  return {
    get(key: string) {
      if (key === 'GENSSL_SSH_CREDENTIAL_KEY') {
        return TEST_KEY;
      }
      if (key === 'NODE_ENV') {
        return 'test';
      }
      return undefined;
    },
  } as ConfigService;
}

async function setup(options?: { withSsh?: boolean }) {
  const withSsh = options?.withSsh !== false;
  const cas = createMemoryRepository<RootCaEntity>();
  const certs = createMemoryRepository<IssuedCertificateEntity>();
  const servers = createMemoryRepository<ServerEntity>();
  const paths = createMemoryRepository<ServerPathEntity>();
  const deploys = createMemoryRepository<DeployRecordEntity>();
  const rustfs = new MemoryRustfsService();
  const archive = new ArchiveService(rustfs as never);
  const caService = new CaService(cas as never, certs as never, archive);
  const certsService = new CertsService(caService, archive, certs as never);
  const crypto = new SshCryptoService(testConfig());
  const world = new MemorySshWorld();
  world.expectedUsername = 'root';
  world.expectedPassword = 'secret';
  world.addDirectory('/etc/nginx/ssl');
  const ssh = new SshService(new MemorySshClientFactory(world));
  const serversService = new ServersService(servers as never, paths as never, crypto, ssh);
  const deployService = new DeployService(
    deploys as never,
    certsService,
    serversService,
    rustfs as never,
    caService,
    archive,
    ssh,
  );
  const root = await caService.create({ name: 'Lan-Root-CA', keySize: 2048, organization: 'Lan' });
  const cert = await certsService.issue({
    caId: root.id,
    ips: ['192.168.99.242'],
    keySize: 2048,
    days: 30,
  });
  const server = await serversService.create(
    withSsh
      ? {
          name: 'web-01',
          host: '192.168.99.242',
          sshUsername: 'root',
          sshPassword: 'secret',
          sshAuthMethod: 'password',
        }
      : { name: 'web-01', host: '192.168.99.242' },
  );
  await serversService.addPath(server.id, { path: '/etc/nginx/ssl', label: 'Nginx cert' });
  const pathId = paths.items[0]!.id;
  return {
    rustfs,
    caService,
    certsService,
    serversService,
    deployService,
    deploys,
    root,
    cert,
    server,
    pathId,
    world,
  };
}

describe('DeployService (remote SFTP deploy)', () => {
  it('fails clearly when the server has no SSH credentials', async () => {
    const { deployService, cert, server, pathId } = await setup({ withSsh: false });
    await assert.rejects(
      () =>
        deployService.deploy({
          certificateId: cert.id,
          serverId: server.id,
          pathId,
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(String((error as BadRequestException).message), /尚未配置远程登录/);
        return true;
      },
    );
  });

  it('writes certificate files over SFTP and keeps a RustFS management copy', async () => {
    const { deployService, rustfs, cert, server, pathId, world } = await setup();
    const result = await deployService.deploy({
      certificateId: cert.id,
      serverId: server.id,
      pathId,
    });

    assert.equal(result.status, 'success');
    assert.equal(result.stale, false);
    assert.equal(result.rustfsSynced, true);
    assert.equal(result.certificateFingerprintSha256, cert.fingerprintSha256);
    assert.equal(result.certificate.status, 'valid');
    assert.equal(result.remote?.destination, 'root@192.168.99.242:/etc/nginx/ssl');
    assert.match(JSON.stringify(result), /已通过 SFTP 写入/);

    const certPath = joinRemoteFile('/etc/nginx/ssl', cert.publicFileName);
    const keyPath = joinRemoteFile('/etc/nginx/ssl', cert.keyFileName);
    assert.ok(world.files.has(certPath));
    assert.ok(world.files.has(keyPath));
    assert.equal(world.files.has('/etc/nginx/ssl/rootCA.key'), false);

    const keys = [...rustfs.objects.keys()];
    assert.ok(keys.some((key) => key.startsWith(`deploy/${server.name}/`)));
    assert.equal(
      keys.filter((key) => key.startsWith('deploy/')).every((key) => !key.includes('archive/')),
      true,
    );
    assert.equal(JSON.stringify(result).includes('secret'), false);
    assert.equal(JSON.stringify(result).includes('BEGIN'), false);
  });

  it('requires overwrite confirmation when the remote directory already has the files', async () => {
    const { deployService, cert, server, pathId, world } = await setup();
    world.addFile(joinRemoteFile('/etc/nginx/ssl', cert.publicFileName), 'old');

    await assert.rejects(
      () =>
        deployService.deploy({
          certificateId: cert.id,
          serverId: server.id,
          pathId,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.match(String((error as ConflictException).message), /远程目录已有文件/);
        assert.match(String((error as ConflictException).message), /开启覆盖选项/);
        return true;
      },
    );

    const overwritten = await deployService.deploy({
      certificateId: cert.id,
      serverId: server.id,
      pathId,
      overwrite: true,
    });
    assert.equal(overwritten.overwritten, true);
    assert.equal(overwritten.status, 'success');
    assert.notEqual(world.files.get(joinRemoteFile('/etc/nginx/ssl', cert.publicFileName))?.body.toString(), 'old');
  });

  it('refuses to deploy a certificate that needs regenerate after the root was overwritten', async () => {
    const { deployService, caService, cert, server, pathId, root, world } = await setup();
    await caService.regenerate(root.id, { keySize: 2048 });

    await assert.rejects(
      () =>
        deployService.deploy({
          certificateId: cert.id,
          serverId: server.id,
          pathId,
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(String((error as BadRequestException).message), /不可用，不能部署/);
        return true;
      },
    );
    assert.equal(world.files.size, 0);
  });

  it('marks an existing deploy stale after the root is overwritten, and again after the cert is regenerated', async () => {
    const { deployService, caService, certsService, cert, server, pathId, root, rustfs } = await setup();
    const first = await deployService.deploy({
      certificateId: cert.id,
      serverId: server.id,
      pathId,
    });
    assert.equal(first.stale, false);

    await caService.regenerate(root.id, { keySize: 2048 });
    const afterRoot = await deployService.get(first.id);
    assert.equal(afterRoot.stale, true);
    assert.equal(afterRoot.staleReason, 'certificate_unavailable');
    assert.equal(afterRoot.certificate.status, 'needs_regenerate');

    const files = await deployService.listTargetFiles(server.id, pathId);
    assert.equal(files.deployStale, true);
    assert.ok(files.latestDeploy?.stale);

    const restored = await certsService.regenerate(cert.id);
    const afterCert = await deployService.get(first.id);
    assert.equal(afterCert.stale, true);
    assert.equal(afterCert.staleReason, 'certificate_overwritten');
    assert.equal(restored.status, 'valid');
    assert.notEqual(afterCert.certificateFingerprintSha256, restored.fingerprintSha256);
    assert.equal([...rustfs.objects.keys()].filter((key) => key.startsWith('deploy/')).length > 0, true);

    const refreshed = await deployService.deploy({
      certificateId: cert.id,
      serverId: server.id,
      pathId,
      overwrite: true,
    });
    assert.equal(refreshed.stale, false);
    assert.equal(refreshed.certificateFingerprintSha256, restored.fingerprintSha256);
    assert.equal(refreshed.overwritten, true);
    assert.equal(refreshed.remote?.path, '/etc/nginx/ssl');
  });

  it('never uploads rootCA.key over SFTP', async () => {
    const { world, cert, deployService, server, pathId } = await setup();
    const result = await deployService.deploy({
      certificateId: cert.id,
      serverId: server.id,
      pathId,
      includeRootCaCert: true,
    });
    const remoteNames = result.files.map((item) => item.fileName);
    assert.equal(remoteNames.some((name) => /rootca\.key/i.test(name)), false);
    assert.equal([...world.files.keys()].some((key) => /rootca\.key/i.test(key)), false);
    assert.equal(result.files.some((item) => item.kind === 'ca-cert'), true);
  });
});
