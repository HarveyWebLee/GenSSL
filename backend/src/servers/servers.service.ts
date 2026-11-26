import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SshCryptoService } from '../ssh/ssh-crypto';
import { describeSshReadiness } from '../ssh/ssh-readiness';
import { assertSafeRemoteDirectory } from '../ssh/ssh-path';
import { SshService } from '../ssh/ssh.service';
import { formatRemoteDestination } from '../ssh/ssh-path';
import {
  DEFAULT_SSH_PORT,
  DEFAULT_SSH_TIMEOUT_MS,
  type HostKeyInfo,
  type PinnedHostKey,
  type ResolvedSshConnection,
  type SshAuthMethod,
} from '../ssh/ssh.types';
import { normalizeDeployPath } from '../storage/object-key';
import {
  CreateServerDto,
  CreateServerPathDto,
  SshCredentialFieldsDto,
  TestServerConnectionDto,
  UpdateServerDto,
  UpdateServerPathDto,
} from './dto/server.dto';
import { ServerPathEntity } from './entities/server-path.entity';
import { ServerEntity } from './entities/server.entity';

export interface ServerDto {
  id: string;
  name: string;
  host: string | null;
  description: string | null;
  sshPort: number;
  sshUsername: string | null;
  sshAuthMethod: SshAuthMethod;
  sshTimeoutMs: number;
  hasPassword: boolean;
  hasPrivateKey: boolean;
  hasPassphrase: boolean;
  sshReady: boolean;
  sshReadyReason: string | null;
  sshHostKeyPinned: boolean;
  sshHostKeyFingerprint: string | null;
  sshHostKeyPinnedAt: string | null;
  paths: Array<{
    id: string;
    path: string;
    label: string | null;
    createdAt: string;
    updatedAt: string;
  }>;
  createdAt: string;
  updatedAt: string;
}

@Injectable()
export class ServersService {
  constructor(
    @InjectRepository(ServerEntity)
    private readonly serverRepo: Repository<ServerEntity>,
    @InjectRepository(ServerPathEntity)
    private readonly pathRepo: Repository<ServerPathEntity>,
    private readonly crypto: SshCryptoService,
    private readonly ssh: SshService,
  ) {}

  async list() {
    const items = await this.serverRepo.find({
      relations: { paths: true },
      order: { createdAt: 'DESC', paths: { createdAt: 'ASC' } },
    });
    return { items: items.map((item) => this.toDto(item)) };
  }

  async create(dto: CreateServerDto) {
    const name = dto.name.trim();
    const existing = await this.serverRepo.findOne({ where: { name } });
    if (existing) {
      throw new ConflictException(`服务器「${name}」已存在。`);
    }
    const row = this.serverRepo.create({
      name,
      host: dto.host?.trim() || null,
      description: dto.description?.trim() || null,
      sshPort: dto.sshPort ?? DEFAULT_SSH_PORT,
      sshUsername: dto.sshUsername?.trim() || null,
      sshAuthMethod: dto.sshAuthMethod ?? 'password',
      sshTimeoutMs: dto.sshTimeoutMs ?? DEFAULT_SSH_TIMEOUT_MS,
      hasSshPassword: false,
      hasSshPrivateKey: false,
      hasSshPassphrase: false,
    });
    this.applyCredentialUpdates(row, dto, { isCreate: true });
    await this.serverRepo.save(row);
    return this.get(row.id);
  }

  async get(id: string) {
    const row = await this.serverRepo.findOne({
      where: { id },
      relations: { paths: true },
      order: { paths: { createdAt: 'ASC' } },
    });
    if (!row) {
      throw new NotFoundException('未找到该服务器。');
    }
    return this.toDto(row);
  }

  async update(id: string, dto: UpdateServerDto) {
    const row = await this.findServerWithSecrets(id);
    const previousHost = row.host;
    const previousPort = row.sshPort;
    if (dto.name && dto.name.trim() !== row.name) {
      const clash = await this.serverRepo.findOne({ where: { name: dto.name.trim() } });
      if (clash) {
        throw new ConflictException(`服务器「${dto.name.trim()}」已存在。`);
      }
      row.name = dto.name.trim();
    }
    if (dto.host !== undefined) {
      row.host = dto.host?.trim() || null;
    }
    if (dto.description !== undefined) {
      row.description = dto.description?.trim() || null;
    }
    if (dto.sshPort !== undefined) {
      row.sshPort = dto.sshPort;
    }
    if (dto.sshUsername !== undefined) {
      row.sshUsername = dto.sshUsername?.trim() || null;
    }
    if (dto.sshAuthMethod !== undefined) {
      row.sshAuthMethod = dto.sshAuthMethod;
    }
    if (dto.sshTimeoutMs !== undefined) {
      row.sshTimeoutMs = dto.sshTimeoutMs;
    }
    this.applyCredentialUpdates(row, dto, { isCreate: false });
    const hostChanged = (row.host ?? '') !== (previousHost ?? '') || row.sshPort !== previousPort;
    if (dto.resetSshHostKey || hostChanged) {
      this.clearPinnedHostKey(row);
    }
    await this.serverRepo.save(row);
    return this.get(id);
  }

  async remove(id: string) {
    const row = await this.findServer(id);
    await this.serverRepo.remove(row);
    return { ok: true, id };
  }

  async addPath(serverId: string, dto: CreateServerPathDto) {
    const server = await this.findServer(serverId);
    const path = this.normalizePathInput(dto.path);
    const clash = await this.pathRepo.findOne({ where: { serverId, path } });
    if (clash) {
      throw new ConflictException(`该服务器已登记路径「${path}」。`);
    }
    const row = this.pathRepo.create({
      serverId: server.id,
      path,
      label: dto.label?.trim() || null,
    });
    await this.pathRepo.save(row);
    return this.get(serverId);
  }

  async updatePath(serverId: string, pathId: string, dto: UpdateServerPathDto) {
    const row = await this.findPath(serverId, pathId);
    if (dto.path !== undefined) {
      const path = this.normalizePathInput(dto.path);
      const clash = await this.pathRepo.findOne({ where: { serverId, path } });
      if (clash && clash.id !== row.id) {
        throw new ConflictException(`该服务器已登记路径「${path}」。`);
      }
      row.path = path;
    }
    if (dto.label !== undefined) {
      row.label = dto.label?.trim() || null;
    }
    await this.pathRepo.save(row);
    return this.get(serverId);
  }

  async removePath(serverId: string, pathId: string) {
    const row = await this.findPath(serverId, pathId);
    await this.pathRepo.remove(row);
    return this.get(serverId);
  }

  async findServer(id: string): Promise<ServerEntity> {
    const row = await this.serverRepo.findOne({ where: { id } });
    if (!row) {
      throw new NotFoundException('未找到该服务器。');
    }
    return row;
  }

  async findPath(serverId: string, pathId: string): Promise<ServerPathEntity> {
    const row = await this.pathRepo.findOne({ where: { id: pathId, serverId } });
    if (!row) {
      throw new NotFoundException('未找到该部署路径。');
    }
    return row;
  }

  async findServerWithSecrets(id: string): Promise<ServerEntity> {
    const row = await this.serverRepo
      .createQueryBuilder('server')
      .addSelect('server.sshPasswordCipher')
      .addSelect('server.sshPrivateKeyCipher')
      .addSelect('server.sshPassphraseCipher')
      .addSelect('server.sshHostKey')
      .where('server.id = :id', { id })
      .getOne();
    if (!row) {
      throw new NotFoundException('未找到该服务器。');
    }
    return row;
  }

  async count(): Promise<number> {
    return this.serverRepo.count();
  }

  getPinnedHostKey(row: ServerEntity): PinnedHostKey | null {
    if (!row.sshHostKey || !row.sshHostKeyFingerprint) {
      return null;
    }
    return {
      algorithm: row.sshHostKeyAlgorithm || 'unknown',
      keyBase64: row.sshHostKey,
      fingerprint: row.sshHostKeyFingerprint,
    };
  }

  async pinHostKey(id: string, hostKey: HostKeyInfo): Promise<void> {
    const row = await this.findServerWithSecrets(id);
    row.sshHostKeyAlgorithm = hostKey.algorithm;
    row.sshHostKey = hostKey.keyBase64;
    row.sshHostKeyFingerprint = hostKey.fingerprint;
    row.sshHostKeyPinnedAt = new Date();
    await this.serverRepo.save(row);
  }

  async resolveConnection(serverId: string, overrides: TestServerConnectionDto = {}): Promise<{
    server?: ServerEntity;
    connection: ResolvedSshConnection;
    pinnedHostKey: PinnedHostKey | null;
  }> {
    const server = serverId ? await this.findServerWithSecrets(serverId) : undefined;
    const host = overrides.host?.trim() || server?.host?.trim() || '';
    const username = overrides.sshUsername?.trim() || server?.sshUsername?.trim() || '';
    const port = overrides.sshPort ?? server?.sshPort ?? DEFAULT_SSH_PORT;
    const authMethod: SshAuthMethod = overrides.sshAuthMethod ?? server?.sshAuthMethod ?? 'password';
    const timeoutMs = overrides.sshTimeoutMs ?? server?.sshTimeoutMs ?? DEFAULT_SSH_TIMEOUT_MS;

    const password =
      overrides.sshPassword?.trim() ||
      (server?.sshPasswordCipher ? this.crypto.decrypt(server.sshPasswordCipher) : undefined);
    const privateKey =
      overrides.sshPrivateKey?.trim() ||
      (server?.sshPrivateKeyCipher ? this.crypto.decrypt(server.sshPrivateKeyCipher) : undefined);
    const passphrase =
      overrides.sshPassphrase?.trim() ||
      (server?.sshPassphraseCipher ? this.crypto.decrypt(server.sshPassphraseCipher) : undefined);

    const readiness = describeSshReadiness({
      host,
      sshUsername: username,
      sshAuthMethod: authMethod,
      hasPassword: Boolean(password),
      hasPrivateKey: Boolean(privateKey),
    });
    if (!readiness.ready) {
      throw new BadRequestException(readiness.reason ?? '尚未配置远程登录。');
    }

    this.crypto.assertReadyForUse();

    return {
      server,
      connection: {
        host,
        port,
        username,
        authMethod,
        password: authMethod === 'password' ? password : undefined,
        privateKey: authMethod === 'privateKey' ? privateKey : undefined,
        passphrase: authMethod === 'privateKey' ? passphrase : undefined,
        timeoutMs,
      },
      pinnedHostKey: overrides.trustHostKey ? null : server ? this.getPinnedHostKey(server) : null,
    };
  }

  async testConnection(dto: TestServerConnectionDto, defaultServerId?: string) {
    const serverId = dto.serverId || defaultServerId;
    const resolved = await this.resolveConnection(serverId ?? '', dto);
    let remotePath = dto.remotePath?.trim() || '';
    if (!remotePath && dto.pathId && resolved.server) {
      const path = await this.findPath(resolved.server.id, dto.pathId);
      remotePath = path.path;
    }
    if (remotePath) {
      remotePath = assertSafeRemoteDirectory(remotePath);
    }

    const outcome = await this.ssh.testConnection({
      connection: resolved.connection,
      pinnedHostKey: resolved.pinnedHostKey,
      trustNewHostKey: Boolean(dto.trustHostKey),
      remotePath: remotePath || undefined,
    });

    if (resolved.server && outcome.newlyTrusted) {
      await this.pinHostKey(resolved.server.id, outcome.hostKey);
    }

    const destination = remotePath
      ? formatRemoteDestination({
          username: resolved.connection.username,
          host: resolved.connection.host,
          port: resolved.connection.port,
          path: remotePath,
        })
      : formatRemoteDestination({
          username: resolved.connection.username,
          host: resolved.connection.host,
          port: resolved.connection.port,
          path: '',
        }).replace(/:$/, '');

    let message = `已成功登录 ${destination}，主机密钥指纹为 ${outcome.hostKey.fingerprint}。`;
    if (outcome.newlyTrusted) {
      message += resolved.server
        ? ' 已记录并锁定该主机密钥，之后连接将校验此指纹。'
        : ' 这是首次连接。保存服务器并再次测试后，将锁定该主机密钥。';
    } else {
      message += ' 已与先前锁定的主机密钥核对一致。';
    }
    if (remotePath) {
      if (outcome.result.pathExists) {
        message += ` 远程目录「${remotePath}」可访问。本次测试未上传任何证书。`;
      } else {
        message += ` 登录成功，但远程目录「${remotePath}」不存在。请先在服务器上创建该目录。本次测试不会自动创建目录，也未上传任何证书。`;
      }
    } else {
      message += ' 本次测试未上传任何证书。';
    }

    return {
      ok: true as const,
      host: resolved.connection.host,
      port: resolved.connection.port,
      username: resolved.connection.username,
      destination,
      path: remotePath || null,
      pathExists: outcome.result.pathExists,
      pathListable: outcome.result.pathListable,
      hostKeyFingerprint: outcome.hostKey.fingerprint,
      hostKeyPinned: Boolean(resolved.server && (outcome.newlyTrusted || resolved.pinnedHostKey)),
      hostKeyNewlyTrusted: outcome.newlyTrusted,
      message,
    };
  }

  private applyCredentialUpdates(
    row: ServerEntity,
    dto: SshCredentialFieldsDto,
    options: { isCreate: boolean },
  ): void {
    const touchingSecrets =
      Boolean(dto.sshPassword) ||
      Boolean(dto.sshPrivateKey) ||
      Boolean(dto.sshPassphrase) ||
      Boolean(dto.clearSshCredentials) ||
      Boolean(dto.clearSshPassword) ||
      Boolean(dto.clearSshPrivateKey) ||
      Boolean(dto.clearSshPassphrase);

    if (touchingSecrets) {
      this.crypto.assertReadyForUse();
    }

    if (dto.clearSshCredentials) {
      row.sshPasswordCipher = null;
      row.sshPrivateKeyCipher = null;
      row.sshPassphraseCipher = null;
      row.hasSshPassword = false;
      row.hasSshPrivateKey = false;
      row.hasSshPassphrase = false;
    }
    if (dto.clearSshPassword) {
      row.sshPasswordCipher = null;
      row.hasSshPassword = false;
    }
    if (dto.clearSshPrivateKey) {
      row.sshPrivateKeyCipher = null;
      row.hasSshPrivateKey = false;
    }
    if (dto.clearSshPassphrase) {
      row.sshPassphraseCipher = null;
      row.hasSshPassphrase = false;
    }
    if (dto.sshPassword) {
      row.sshPasswordCipher = this.crypto.encrypt(dto.sshPassword);
      row.hasSshPassword = true;
    }
    if (dto.sshPrivateKey) {
      row.sshPrivateKeyCipher = this.crypto.encrypt(dto.sshPrivateKey);
      row.hasSshPrivateKey = true;
    }
    if (dto.sshPassphrase) {
      row.sshPassphraseCipher = this.crypto.encrypt(dto.sshPassphrase);
      row.hasSshPassphrase = true;
    }

    if (options.isCreate && (dto.sshPassword || dto.sshPrivateKey || dto.sshPassphrase)) {
      this.crypto.assertReadyForUse();
    }
  }

  private clearPinnedHostKey(row: ServerEntity): void {
    row.sshHostKeyAlgorithm = null;
    row.sshHostKey = null;
    row.sshHostKeyFingerprint = null;
    row.sshHostKeyPinnedAt = null;
  }

  private normalizePathInput(raw: string): string {
    const trimmed = raw.trim();
    // Keep the user-facing path mostly as entered, but reject traversal.
    normalizeDeployPath(trimmed);
    assertSafeRemoteDirectory(trimmed);
    if (trimmed.includes('\0')) {
      throw new ConflictException('部署路径无效。');
    }
    return trimmed.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/+$/, '') || trimmed;
  }

  private toDto(row: ServerEntity): ServerDto {
    const readiness = describeSshReadiness({
      host: row.host,
      sshUsername: row.sshUsername,
      sshAuthMethod: row.sshAuthMethod,
      hasPassword: row.hasSshPassword,
      hasPrivateKey: row.hasSshPrivateKey,
    });
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      description: row.description,
      sshPort: row.sshPort ?? DEFAULT_SSH_PORT,
      sshUsername: row.sshUsername,
      sshAuthMethod: row.sshAuthMethod ?? 'password',
      sshTimeoutMs: row.sshTimeoutMs ?? DEFAULT_SSH_TIMEOUT_MS,
      hasPassword: Boolean(row.hasSshPassword),
      hasPrivateKey: Boolean(row.hasSshPrivateKey),
      hasPassphrase: Boolean(row.hasSshPassphrase),
      sshReady: readiness.ready,
      sshReadyReason: readiness.reason,
      sshHostKeyPinned: Boolean(row.sshHostKeyFingerprint),
      sshHostKeyFingerprint: row.sshHostKeyFingerprint,
      sshHostKeyPinnedAt: row.sshHostKeyPinnedAt ? row.sshHostKeyPinnedAt.toISOString() : null,
      paths: (row.paths ?? []).map((item) => ({
        id: item.id,
        path: item.path,
        label: item.label,
        createdAt: item.createdAt.toISOString(),
        updatedAt: item.updatedAt.toISOString(),
      })),
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }
}
