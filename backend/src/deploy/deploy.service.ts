import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import path from 'node:path';
import { Repository } from 'typeorm';
import { ArchiveService } from '../archive/archive.service';
import { CaService } from '../ca/ca.service';
import { CertsService } from '../certs/certs.service';
import {
  certificateStatusLabel,
  computeCertificateStatus,
  type CertificateLifecycleStatus,
} from '../certs/cert-status';
import { IssuedCertificateEntity } from '../certs/issued-certificate.entity';
import { ServersService } from '../servers/servers.service';
import { SshService } from '../ssh/ssh.service';
import { formatRemoteDestination, joinRemoteFile } from '../ssh/ssh-path';
import { buildDeployObjectKey, buildDeployObjectPrefix, DEPLOY_ROOT } from '../storage/object-key';
import { assertSafeObjectKey, isForbiddenUploadName, isServerPrivateKeyName } from '../storage/upload-guard';
import { RustfsService } from '../storage/rustfs.service';
import {
  DeployRecordEntity,
  type DeployedFile,
  type DeployedFileKind,
  type DeployRecordStatus,
} from './deploy-record.entity';
import { resolveDeployStale, type DeployStaleReason } from './deploy-status';
import { CreateDeployDto } from './dto/create-deploy.dto';

export interface RemoteDestinationDto {
  host: string;
  port: number;
  username: string;
  path: string;
  destination: string;
}

export interface DeployRecordDto {
  id: string;
  storageKind: 'deploy';
  storageLabel: string;
  certificate: {
    id: string;
    name?: string;
    commonName?: string;
    publicFileName?: string;
    keyFileName?: string;
    caId?: string;
    status?: CertificateLifecycleStatus;
    statusLabel?: string;
    fingerprintSha256?: string;
  };
  server: { id: string; name?: string; host?: string | null; sshReady?: boolean; sshReadyReason?: string | null };
  path: { id: string; path?: string; label?: string | null };
  objectPrefix: string;
  files: DeployedFile[];
  overwritten: boolean;
  certificateFingerprintSha256: string;
  stale: boolean;
  staleReason: DeployStaleReason;
  staleLabel: string | null;
  status: DeployRecordStatus;
  errorMessage: string | null;
  remote: RemoteDestinationDto | null;
  rustfsSynced: boolean;
  createdAt: string;
  warning?: string;
}

@Injectable()
export class DeployService {
  constructor(
    @InjectRepository(DeployRecordEntity)
    private readonly repo: Repository<DeployRecordEntity>,
    private readonly certsService: CertsService,
    private readonly serversService: ServersService,
    private readonly rustfs: RustfsService,
    private readonly caService: CaService,
    private readonly archiveService: ArchiveService,
    private readonly ssh: SshService,
  ) {}

  async list() {
    const items = await this.repo.find({
      relations: { certificate: true, server: true, path: true },
      order: { createdAt: 'DESC' },
    });
    const dtos: DeployRecordDto[] = [];
    for (const item of items) {
      dtos.push(this.toDto(await this.hydrate(item)));
    }
    return { items: dtos };
  }

  async get(id: string) {
    const row = await this.repo.findOne({
      where: { id },
      relations: { certificate: true, server: true, path: true },
    });
    if (!row) {
      throw new NotFoundException('未找到该上传记录。');
    }
    return this.toDto(await this.hydrate(row));
  }

  async listTargetFiles(serverId: string, pathId: string) {
    const server = await this.serversService.findServer(serverId);
    const deployPath = await this.serversService.findPath(serverId, pathId);
    const prefix = buildDeployObjectPrefix(server.name, deployPath.path);
    const serverDto = (await this.serversService.get(serverId));

    let files: Awaited<ReturnType<RustfsService['listPrefix']>> = [];
    let rustfsError: string | null = null;
    try {
      this.rustfs.assertReady();
      files = await this.rustfs.listPrefix(prefix);
    } catch (error) {
      rustfsError = error instanceof Error ? error.message : '无法列出文件服务器中的管理副本。';
    }

    const latest = await this.repo.findOne({
      where: { serverId, pathId, status: 'success' },
      order: { createdAt: 'DESC' },
      relations: { certificate: true, server: true, path: true },
    });
    const latestDeploy = latest ? this.toDto(await this.hydrate(latest)) : null;

    let remote: {
      destination: string;
      exists: boolean;
      files: Array<{ fileName: string; path: string; size: number; lastModified?: string; kind: string }>;
      error?: string;
    } | null = null;

    if (serverDto.sshReady) {
      try {
        const resolved = await this.serversService.resolveConnection(serverId);
        const listed = await this.ssh.listDirectory({
          connection: resolved.connection,
          pinnedHostKey: resolved.pinnedHostKey,
          remotePath: deployPath.path,
        });
        if (listed.newlyTrusted) {
          await this.serversService.pinHostKey(serverId, listed.hostKey);
        }
        remote = {
          destination: formatRemoteDestination({
            username: resolved.connection.username,
            host: resolved.connection.host,
            port: resolved.connection.port,
            path: deployPath.path,
          }),
          exists: listed.result.exists,
          files: listed.result.entries
            .filter((entry) => entry.isFile)
            .map((entry) => ({
              fileName: entry.fileName,
              path: joinRemoteFile(deployPath.path, entry.fileName),
              size: entry.size,
              lastModified: entry.mtime?.toISOString(),
              kind: this.guessKind(entry.fileName),
            })),
        };
      } catch (error) {
        remote = {
          destination: formatRemoteDestination({
            username: server.sshUsername,
            host: server.host ?? '',
            port: server.sshPort,
            path: deployPath.path,
          }),
          exists: false,
          files: [],
          error: error instanceof Error ? error.message : '无法列出远程目录。',
        };
      }
    }

    return {
      storageKind: 'deploy' as const,
      storageLabel: '服务器部署目录',
      server: {
        id: server.id,
        name: server.name,
        host: server.host,
        sshReady: serverDto.sshReady,
        sshReadyReason: serverDto.sshReadyReason,
      },
      path: { id: deployPath.id, path: deployPath.path, label: deployPath.label },
      prefix,
      files: files.map((file) => ({
        ...file,
        fileName: file.key.slice(prefix.length + 1),
        kind: this.guessKind(file.key),
        storageKind: 'deploy' as const,
      })),
      rustfsError,
      remote,
      latestDeploy,
      deployStale: latestDeploy?.stale ?? false,
      deployStaleLabel: latestDeploy?.staleLabel ?? null,
    };
  }

  async deploy(dto: CreateDeployDto) {
    const certificate = await this.certsService.findRecord(dto.certificateId);
    const status = this.certStatus(certificate);
    if (status === 'needs_regenerate') {
      throw new BadRequestException(
        '该证书因所属根证书被重新生成而不可用，不能部署到服务器目录。请先在证书列表中「重新生成并覆盖」，再重新上传。部署目录不会自动改写。',
      );
    }
    const serverMeta = await this.serversService.get(dto.serverId);
    if (!serverMeta.sshReady) {
      throw new BadRequestException(serverMeta.sshReadyReason ?? '尚未配置远程登录，无法上传到服务器。');
    }
    const server = await this.serversService.findServer(dto.serverId);
    const deployPath = await this.serversService.findPath(dto.serverId, dto.pathId);
    const material = await this.certsService.readArchiveMaterial(certificate.id);

    const planned: Array<{
      kind: DeployedFileKind;
      fileName: string;
      body: string;
      contentType: string;
      mode: number;
    }> = [
      {
        kind: 'server-cert',
        fileName: certificate.publicFileName,
        body: material.certPem,
        contentType: 'application/x-x509-ca-cert',
        mode: 0o644,
      },
      {
        kind: 'server-key',
        fileName: certificate.keyFileName,
        body: material.keyPem,
        contentType: 'application/x-pem-file',
        mode: isServerPrivateKeyName(certificate.keyFileName) ? 0o600 : 0o600,
      },
    ];

    if (dto.includeRootCaCert) {
      const { row } = await this.caService.loadPublicMaterial(certificate.caId);
      planned.push({
        kind: 'ca-cert',
        fileName: row.publicFileName,
        body: row.certificatePem,
        contentType: 'application/x-x509-ca-cert',
        mode: 0o644,
      });
    }

    for (const item of planned) {
      if (isForbiddenUploadName(item.fileName)) {
        throw new BadRequestException(
          '禁止上传 rootCA.key。根 CA 私钥只保存在数据库中，不会出现在部署目录、远程服务器或证书库中。',
        );
      }
    }

    const prefix = buildDeployObjectPrefix(server.name, deployPath.path);
    const keys = planned.map((item) => buildDeployObjectKey(server.name, deployPath.path, item.fileName));
    const resolved = await this.serversService.resolveConnection(server.id, {
      trustHostKey: dto.trustHostKey,
    });
    const remoteDestination = formatRemoteDestination({
      username: resolved.connection.username,
      host: resolved.connection.host,
      port: resolved.connection.port,
      path: deployPath.path,
    });

    const existingRemote: string[] = [];
    const existingRustfs: string[] = [];
    const probed = await this.ssh.probeFiles({
      connection: resolved.connection,
      pinnedHostKey: dto.trustHostKey ? null : resolved.pinnedHostKey,
      trustNewHostKey: Boolean(dto.trustHostKey),
      remotePath: deployPath.path,
      fileNames: planned.map((item) => item.fileName),
    });
    if (probed.newlyTrusted) {
      await this.serversService.pinHostKey(server.id, probed.hostKey);
    }
    for (const file of probed.result.files) {
      if (file.exists) {
        existingRemote.push(file.path);
      }
    }
    if (this.isRustfsReady()) {
      for (const key of keys) {
        if (await this.rustfs.objectExists(key)) {
          existingRustfs.push(key);
        }
      }
    }
    if (!dto.overwrite && (existingRemote.length > 0 || existingRustfs.length > 0)) {
      const parts: string[] = [];
      if (existingRemote.length > 0) {
        parts.push(`远程目录已有文件：${existingRemote.join('，')}`);
      }
      if (existingRustfs.length > 0) {
        parts.push(`文件服务器管理副本中已有文件：${existingRustfs.join('，')}`);
      }
      throw new ConflictException(`${parts.join('。')}。如需覆盖，请确认后开启覆盖选项。`);
    }

    let writtenRemote: Array<{ fileName: string; path: string; size: number }> = [];
    try {
      const uploaded = await this.ssh.uploadFiles({
        connection: resolved.connection,
        pinnedHostKey: probed.hostKey,
        trustNewHostKey: false,
        remotePath: deployPath.path,
        files: planned.map((item) => ({
          fileName: item.fileName,
          body: item.body,
          mode: item.mode,
        })),
      });
      if (uploaded.newlyTrusted) {
        await this.serversService.pinHostKey(server.id, uploaded.hostKey);
      }
      writtenRemote = uploaded.result.written;
    } catch (error) {
      const message = error instanceof Error ? error.message : '远程上传失败。';
      await this.saveRecord({
        certificate,
        serverId: server.id,
        pathId: deployPath.id,
        prefix,
        files: planned.map((item) => ({
          kind: item.kind,
          fileName: item.fileName,
          objectKey: buildDeployObjectKey(server.name, deployPath.path, item.fileName),
          size: Buffer.byteLength(item.body),
          remotePath: joinRemoteFile(deployPath.path, item.fileName),
        })),
        overwritten: Boolean(dto.overwrite),
        status: 'failed',
        errorMessage: message,
        remote: {
          host: resolved.connection.host,
          port: resolved.connection.port,
          username: resolved.connection.username,
          path: deployPath.path,
        },
        rustfsSynced: false,
      });
      throw error;
    }

    const uploaded: DeployedFile[] = [];
    let rustfsSynced = false;
    let rustfsError: string | null = null;
    try {
      this.rustfs.assertReady();
      for (const item of planned) {
        const objectKey = buildDeployObjectKey(server.name, deployPath.path, item.fileName);
        const stored = await this.rustfs.putObject(objectKey, item.body, item.contentType);
        const remoteFile = writtenRemote.find((file) => file.fileName === item.fileName);
        uploaded.push({
          kind: item.kind,
          fileName: item.fileName,
          objectKey: stored.key,
          size: stored.size,
          remotePath: remoteFile?.path ?? joinRemoteFile(deployPath.path, item.fileName),
        });
      }
      rustfsSynced = true;
    } catch (error) {
      rustfsError = error instanceof Error ? error.message : '文件服务器管理副本写入失败。';
      for (const item of planned) {
        const remoteFile = writtenRemote.find((file) => file.fileName === item.fileName);
        uploaded.push({
          kind: item.kind,
          fileName: item.fileName,
          objectKey: buildDeployObjectKey(server.name, deployPath.path, item.fileName),
          size: remoteFile?.size ?? Buffer.byteLength(item.body),
          remotePath: remoteFile?.path ?? joinRemoteFile(deployPath.path, item.fileName),
        });
      }
    }

    const record = await this.saveRecord({
      certificate,
      serverId: server.id,
      pathId: deployPath.id,
      prefix,
      files: uploaded,
      overwritten: Boolean(dto.overwrite),
      status: 'success',
      errorMessage: rustfsError,
      remote: {
        host: resolved.connection.host,
        port: resolved.connection.port,
        username: resolved.connection.username,
        path: deployPath.path,
      },
      rustfsSynced,
    });
    const dtoResult = await this.get(record.id);
    return dtoResult;
  }

  async openStoredFile(objectKey: string) {
    const key = assertSafeObjectKey(objectKey);
    return this.archiveService.openStoredFile(key);
  }

  private isRustfsReady(): boolean {
    const status = this.rustfs.getStatus?.();
    return Boolean(status?.ready);
  }

  private async saveRecord(input: {
    certificate: IssuedCertificateEntity;
    serverId: string;
    pathId: string;
    prefix: string;
    files: DeployedFile[];
    overwritten: boolean;
    status: DeployRecordStatus;
    errorMessage: string | null;
    remote: { host: string; port: number; username: string; path: string };
    rustfsSynced: boolean;
  }): Promise<DeployRecordEntity> {
    const record = this.repo.create({
      certificateId: input.certificate.id,
      serverId: input.serverId,
      pathId: input.pathId,
      objectPrefix: input.prefix,
      files: input.files,
      overwritten: input.overwritten,
      certificateFingerprintSha256: input.certificate.fingerprintSha256,
      status: input.status,
      errorMessage: input.errorMessage,
      remoteHost: input.remote.host,
      remotePort: input.remote.port,
      remoteUsername: input.remote.username,
      remotePath: input.remote.path,
      rustfsSynced: input.rustfsSynced,
    });
    return this.repo.save(record);
  }

  private guessKind(objectKey: string): DeployedFileKind | 'unknown' {
    const base = path.posix.basename(objectKey.replace(/\\/g, '/'));
    if (isForbiddenUploadName(base)) {
      return 'unknown';
    }
    if (/\.key$/i.test(base)) {
      return 'server-key';
    }
    if (/root/i.test(base) && /\.(crt|cer|pem)$/i.test(base)) {
      return 'ca-cert';
    }
    if (/\.(crt|cer|pem)$/i.test(base)) {
      return 'server-cert';
    }
    return 'unknown';
  }

  private async hydrate(row: DeployRecordEntity): Promise<DeployRecordEntity> {
    if (!row.certificate?.ca) {
      try {
        row.certificate = await this.certsService.findRecord(row.certificateId);
      } catch {
        // 证书可能已被删除，保留已有快照。
      }
    }
    if (!row.server) {
      try {
        row.server = await this.serversService.findServer(row.serverId);
      } catch {
        // 服务器可能已被删除。
      }
    }
    if (!row.path) {
      try {
        row.path = await this.serversService.findPath(row.serverId, row.pathId);
      } catch {
        // 路径可能已被删除。
      }
    }
    return row;
  }

  private certStatus(certificate: IssuedCertificateEntity): CertificateLifecycleStatus {
    return computeCertificateStatus({
      caStatus: certificate.ca?.status ?? 'active',
      caGeneration: certificate.ca?.generation,
      certCaGeneration: certificate.caGeneration,
      issuerFingerprintSha256: certificate.issuerFingerprintSha256,
      caFingerprintSha256: certificate.ca?.fingerprintSha256,
      notBefore: certificate.notBefore,
      notAfter: certificate.notAfter,
    });
  }

  private toDto(row: DeployRecordEntity): DeployRecordDto {
    const certificate = row.certificate;
    const status = certificate ? this.certStatus(certificate) : undefined;
    const stale =
      row.status === 'failed'
        ? { stale: false, staleReason: null, staleLabel: null }
        : resolveDeployStale({
            storedFingerprint: row.certificateFingerprintSha256,
            currentFingerprint: certificate?.fingerprintSha256,
            certStatus: status ?? 'valid',
            deployedAt: row.createdAt,
            certUpdatedAt: certificate?.updatedAt,
          });
    const remote =
      row.remoteHost && row.remotePath
        ? {
            host: row.remoteHost,
            port: row.remotePort ?? 22,
            username: row.remoteUsername ?? '',
            path: row.remotePath,
            destination: formatRemoteDestination({
              username: row.remoteUsername,
              host: row.remoteHost,
              port: row.remotePort,
              path: row.remotePath,
            }),
          }
        : null;
    const baseWarning = remote
      ? `文件已通过 SFTP 写入 ${remote.destination}。对象前缀 ${DEPLOY_ROOT}/ 中保留一份管理副本，与证书库（archive/）分开。服务器私钥只用于该 Nginx 主机，不要分发给客户端。rootCA.key 从未上传、也不会出现在远程目录中。`
      : `这是历史部署记录，当时写入的是文件服务器中的 ${DEPLOY_ROOT}/ 前缀，尚未通过 SSH 写入远程磁盘。`;
    const extras: string[] = [];
    if (row.status === 'failed' && row.errorMessage) {
      extras.push(`远程上传失败：${row.errorMessage}`);
    }
    if (row.status === 'success' && !row.rustfsSynced && row.errorMessage) {
      extras.push(`远程写入已成功，但文件服务器管理副本未能保存：${row.errorMessage}`);
    }
    if (stale.staleLabel) {
      extras.push(
        stale.staleLabel + '。重新上传时请打开「覆盖已有文件」，远程服务器上的同名文件也会被覆盖。部署目录不会在重新生成时自动改写。',
      );
    }
    if (status === 'needs_reissue') {
      extras.push('该证书所属根已停用，仅建议在迁移期间临时使用已上传的文件。');
    }
    return {
      id: row.id,
      storageKind: 'deploy' as const,
      storageLabel: '服务器部署目录',
      certificate: certificate
        ? {
            id: certificate.id,
            name: certificate.name,
            commonName: certificate.commonName,
            publicFileName: certificate.publicFileName,
            keyFileName: certificate.keyFileName,
            caId: certificate.caId,
            status,
            statusLabel: status ? certificateStatusLabel(status) : undefined,
            fingerprintSha256: certificate.fingerprintSha256,
          }
        : { id: row.certificateId },
      server: row.server
        ? {
            id: row.server.id,
            name: row.server.name,
            host: row.server.host,
          }
        : { id: row.serverId },
      path: row.path
        ? { id: row.path.id, path: row.path.path, label: row.path.label }
        : { id: row.pathId },
      objectPrefix: row.objectPrefix,
      files: row.files,
      overwritten: row.overwritten,
      certificateFingerprintSha256: row.certificateFingerprintSha256 ?? '',
      stale: stale.stale,
      staleReason: stale.staleReason,
      staleLabel: stale.staleLabel,
      status: row.status ?? 'success',
      errorMessage: row.errorMessage,
      remote,
      rustfsSynced: Boolean(row.rustfsSynced),
      createdAt: row.createdAt.toISOString(),
      warning: [baseWarning, ...extras].join(' '),
    };
  }
}
