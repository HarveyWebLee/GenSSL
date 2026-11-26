import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ServersService } from '../servers/servers.service';
import { ServerEntity } from '../servers/entities/server.entity';
import { ServerPathEntity } from '../servers/entities/server-path.entity';
import { SshCryptoService } from '../ssh/ssh-crypto';
import { MemorySshClientFactory, MemorySshWorld } from '../ssh/memory-ssh';
import { SshService } from '../ssh/ssh.service';
import { createMemoryRepository } from '../testing/memory-repo';
import { MemoryRustfsService } from '../testing/memory-rustfs';
import { NginxServiceReleaseEntity } from './entities/nginx-service-release.entity';
import { NginxServiceEntity } from './entities/nginx-service.entity';
import { NginxServicesService } from './nginx-services.service';

const TEST_KEY = '0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef';
const CONF = [
  'server {',
  '    listen 8080 ssl;',
  '    server_name avatar.local;',
  '}',
  '',
].join('\n');

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

async function setup(options?: { withSsh?: boolean; directory?: string }) {
  const withSsh = options?.withSsh !== false;
  const directory = options?.directory ?? '/data/smartsecurity/nginx/vhost';
  const servers = createMemoryRepository<ServerEntity>();
  const paths = createMemoryRepository<ServerPathEntity>();
  const services = createMemoryRepository<NginxServiceEntity>();
  const releases = createMemoryRepository<NginxServiceReleaseEntity>();
  const rustfs = new MemoryRustfsService();
  const crypto = new SshCryptoService(testConfig());
  const world = new MemorySshWorld();
  world.expectedUsername = 'root';
  world.expectedPassword = 'secret';
  world.addDirectory(directory);
  const ssh = new SshService(new MemorySshClientFactory(world));
  const serversService = new ServersService(servers as never, paths as never, crypto, ssh);
  const nginxServices = new NginxServicesService(
    services as never,
    releases as never,
    serversService,
    ssh,
    rustfs as never,
  );
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
  return { nginxServices, serversService, rustfs, world, server, services, releases };
}

describe('NginxServicesService', () => {
  it('rejects non-unique name, port and conf path on the same server, and requires a .conf absolute path', async () => {
    const { nginxServices, server } = await setup();
    const created = await nginxServices.create({
      serverId: server.id,
      name: 'avatar',
      port: 8080,
      configPath: '/data/smartsecurity/nginx/vhost/avatar.conf',
      configText: CONF,
      restartCommand: 'docker restart nginx',
    });
    assert.equal(created.restartCommand, 'docker restart nginx');
    assert.equal(created.configPath, '/data/smartsecurity/nginx/vhost/avatar.conf');
    assert.ok(created.archive.uploaded);
    assert.match(created.archive.objectKey ?? '', /nginx\/services\//);

    await assert.rejects(
      () =>
        nginxServices.create({
          serverId: server.id,
          name: 'avatar',
          port: 8081,
          configPath: '/data/smartsecurity/nginx/vhost/other.conf',
          configText: CONF,
          restartCommand: 'docker restart nginx',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.match(String((error as ConflictException).message), /名称必须唯一/);
        return true;
      },
    );
    await assert.rejects(
      () =>
        nginxServices.create({
          serverId: server.id,
          name: 'other',
          port: 8080,
          configPath: '/data/smartsecurity/nginx/vhost/other.conf',
          configText: CONF,
          restartCommand: 'docker restart nginx',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.match(String((error as ConflictException).message), /端口必须唯一/);
        return true;
      },
    );
    await assert.rejects(
      () =>
        nginxServices.create({
          serverId: server.id,
          name: 'other',
          port: 8081,
          configPath: '/data/smartsecurity/nginx/vhost/avatar.conf',
          configText: CONF,
          restartCommand: 'docker restart nginx',
        }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.match(String((error as ConflictException).message), /路径必须唯一/);
        return true;
      },
    );
    await assert.rejects(
      () =>
        nginxServices.create({
          serverId: server.id,
          name: 'bad-path',
          port: 8090,
          configPath: '/data/smartsecurity/nginx/vhost/avatar.txt',
          configText: CONF,
          restartCommand: 'docker restart nginx',
        }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(String((error as BadRequestException).message), /\.conf/);
        return true;
      },
    );
    await assert.rejects(
      () =>
        nginxServices.create({
          serverId: server.id,
          name: 'relative',
          port: 8091,
          configPath: 'vhost/avatar.conf',
          configText: CONF,
          restartCommand: 'docker restart nginx',
        }),
      BadRequestException,
    );
  });

  it('stores the restart command on the service, not on the publish payload, and writes then restarts', async () => {
    const { nginxServices, rustfs, world, server } = await setup();
    const service = await nginxServices.create({
      serverId: server.id,
      name: 'avatar',
      port: 8080,
      configPath: '/data/smartsecurity/nginx/vhost/avatar.conf',
      configText: CONF,
      restartCommand: 'docker restart nginx',
    });

    const published = await nginxServices.publish(service.id, {
      version: '1.0.0',
      remark: '首次上线',
    });
    assert.equal(published.status, 'success');
    assert.equal(published.version, '1.0.0');
    assert.equal(published.restartCommandUsed, 'docker restart nginx');
    assert.equal(published.written, true);
    assert.equal(published.restartExecuted, true);
    assert.equal(published.restartExitCode, 0);
    assert.equal(world.files.get('/data/smartsecurity/nginx/vhost/avatar.conf')?.body.toString('utf8'), CONF);
    assert.deepEqual(world.executedCommands, ['docker restart nginx']);
    assert.ok([...rustfs.objects.keys()].some((key) => key.includes('/releases/')));
    assert.equal(JSON.stringify(published).includes('secret'), false);

    await assert.rejects(
      () => nginxServices.publish(service.id, { version: '1.0.0', remark: '重复版本' }),
      (error: unknown) => {
        assert.ok(error instanceof ConflictException);
        assert.match(String((error as ConflictException).message), /版本号/);
        return true;
      },
    );
  });

  it('does not run the restart command when remote write fails, and reports partial success when restart fails after a write', async () => {
    const { nginxServices, world, server } = await setup();
    const service = await nginxServices.create({
      serverId: server.id,
      name: 'avatar',
      port: 8080,
      configPath: '/data/smartsecurity/nginx/vhost/avatar.conf',
      configText: CONF,
      restartCommand: 'docker restart nginx',
    });

    world.writeError = new BadRequestException(
      '远程目录不存在：/data/smartsecurity/nginx/vhost。请先在服务器上创建该目录，并确认账号有写权限。',
    );
    await assert.rejects(
      () => nginxServices.publish(service.id, { version: '1.0.0', remark: '失败发布' }),
      (error: unknown) => {
        assert.ok(error instanceof BadRequestException);
        assert.match(String((error as BadRequestException).message), /远程目录不存在/);
        return true;
      },
    );
    assert.equal(world.executedCommands.length, 0);
    const failed = (await nginxServices.listReleases(service.id)).items[0]!;
    assert.equal(failed.status, 'failed');
    assert.equal(failed.written, false);
    assert.equal(failed.restartExecuted, false);

    world.writeError = undefined;
    world.execResult = { exitCode: 1, stdout: '', stderr: 'nginx: failed' };
    const partial = await nginxServices.publish(service.id, { version: '1.0.1', remark: '重启失败' });
    assert.equal(partial.status, 'partial');
    assert.equal(partial.written, true);
    assert.ok(world.files.has('/data/smartsecurity/nginx/vhost/avatar.conf'));
    assert.match(partial.warning ?? partial.errorMessage ?? '', /已覆盖/);
    assert.match(partial.warning ?? partial.errorMessage ?? '', /尚未加载新配置|重启/);
  });

  it('republishes a historical version with the current restart command and allows name reuse after soft delete', async () => {
    const { nginxServices, world, server, services } = await setup();
    const service = await nginxServices.create({
      serverId: server.id,
      name: 'avatar',
      port: 8080,
      configPath: '/data/smartsecurity/nginx/vhost/avatar.conf',
      configText: CONF,
      restartCommand: 'docker restart nginx',
    });
    const first = await nginxServices.publish(service.id, { version: '1.0.0', remark: '初版' });
    await nginxServices.update(service.id, {
      configText: `${CONF}\n# updated\n`,
      restartCommand: 'systemctl reload nginx',
    });
    world.executedCommands.length = 0;
    const again = await nginxServices.republish(service.id, first.id);
    assert.equal(again.version, '1.0.0');
    assert.equal(again.sourceReleaseId, first.id);
    assert.notEqual(again.id, first.id);
    assert.equal(again.configText, CONF);
    assert.equal(again.restartCommandUsed, 'systemctl reload nginx');
    assert.deepEqual(world.executedCommands, ['systemctl reload nginx']);
    assert.equal(world.files.get('/data/smartsecurity/nginx/vhost/avatar.conf')?.body.toString('utf8'), CONF);

    const listedAfterPublish = await nginxServices.listReleases(service.id);
    assert.equal(listedAfterPublish.items.length, 2);

    await nginxServices.softDeleteRelease(service.id, again.id);
    const visible = await nginxServices.listReleases(service.id);
    assert.equal(visible.items.length, 1);
    assert.equal(visible.items[0]!.id, first.id);

    await nginxServices.softDelete(service.id);
    assert.equal((await nginxServices.list()).items.length, 0);
    await assert.rejects(() => nginxServices.get(service.id), NotFoundException);
    assert.ok(services.items[0]!.deletedAt);

    const reused = await nginxServices.create({
      serverId: server.id,
      name: 'avatar',
      port: 8080,
      configPath: '/data/smartsecurity/nginx/vhost/avatar.conf',
      configText: CONF,
      restartCommand: 'docker restart nginx',
    });
    assert.notEqual(reused.id, service.id);
  });

  it('manual restart uses the command stored on the service', async () => {
    const { nginxServices, world, server } = await setup();
    const service = await nginxServices.create({
      serverId: server.id,
      name: 'avatar',
      port: 8080,
      configPath: '/data/smartsecurity/nginx/vhost/avatar.conf',
      configText: CONF,
      restartCommand: 'docker restart nginx',
    });
    const result = await nginxServices.restart(service.id);
    assert.equal(result.ok, true);
    assert.equal(result.command, 'docker restart nginx');
    assert.deepEqual(world.executedCommands, ['docker restart nginx']);
    assert.match(result.message, /已成功完成/);
    assert.equal(JSON.stringify(result).includes('secret'), false);
  });
});
