import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { Readable } from 'node:stream';
import { IsNull, type FindOptionsWhere, Repository } from 'typeorm';
import { buildContentDisposition } from '../ca/ca-filename';
import { ServersService } from '../servers/servers.service';
import type { ServerDto } from '../servers/servers.service';
import { SshService } from '../ssh/ssh.service';
import { assertRestartCommand, assertSafeRemoteConfPath, formatRemoteDestination } from '../ssh/ssh-path';
import { buildNginxReleaseObjectKey, buildNginxServiceObjectKey } from '../storage/object-key';
import { RustfsService } from '../storage/rustfs.service';
import type { CreateNginxServiceDto, PublishNginxServiceDto, UpdateNginxServiceDto } from './dto/nginx-service.dto';
import { NginxServiceReleaseEntity, type NginxReleaseStatus } from './entities/nginx-service-release.entity';
import { NginxServiceEntity } from './entities/nginx-service.entity';

export interface NginxServiceArchiveDto {
  storageKind: 'nginx';
  storageLabel: 'Nginx 配置管理副本';
  uploaded: boolean;
  objectKey: string | null;
  uploadedAt: string | null;
}

export interface NginxServiceServerRef {
  id: string;
  name: string;
  host: string | null;
  sshPort: number;
  sshUsername: string | null;
  sshReady: boolean;
  sshReadyReason: string | null;
}

export interface NginxReleaseSummary {
  id: string;
  version: string;
  remark: string;
  status: NginxReleaseStatus;
  statusLabel: string;
  publishedAt: string;
  sourceReleaseId: string | null;
  configPath: string;
}

export interface NginxServiceSummary {
  id: string;
  server: NginxServiceServerRef;
  name: string;
  port: number;
  configPath: string;
  restartCommand: string;
  archive: NginxServiceArchiveDto;
  currentRelease: NginxReleaseSummary | null;
  releaseCount: number;
  createdAt: string;
  updatedAt: string;
  warning?: string;
}

export interface NginxServiceDetail extends NginxServiceSummary {
  configText: string;
}

export interface NginxReleaseDetail {
  id: string;
  serviceId: string;
  serviceName: string;
  version: string;
  remark: string;
  configPath: string;
  configText?: string;
  sourceReleaseId: string | null;
  sourceVersion: string | null;
  status: NginxReleaseStatus;
  statusLabel: string;
  publishedAt: string;
  written: boolean;
  restartCommandUsed: string;
  restartExecuted: boolean;
  restartExitCode: number | null;
  restartStdout: string | null;
  restartStderr: string | null;
  errorMessage: string | null;
  rustfsSynced: boolean;
  archive: NginxServiceArchiveDto;
  remote: {
    host: string;
    port: number;
    username: string;
    path: string;
    destination: string;
  } | null;
  warning?: string;
}

const VERSION_PATTERN = /^[A-Za-z0-9._+-]+$/;

function statusLabel(status: NginxReleaseStatus): string {
  if (status === 'success') {
    return '发布成功';
  }
  if (status === 'partial') {
    return '文件已覆盖，重启失败';
  }
  return '发布失败';
}

@Injectable()
export class NginxServicesService {
  constructor(
    @InjectRepository(NginxServiceEntity)
    private readonly serviceRepo: Repository<NginxServiceEntity>,
    @InjectRepository(NginxServiceReleaseEntity)
    private readonly releaseRepo: Repository<NginxServiceReleaseEntity>,
    private readonly serversService: ServersService,
    private readonly ssh: SshService,
    private readonly rustfs: RustfsService,
  ) {}

  async list(serverId?: string): Promise<{ items: NginxServiceSummary[] }> {
    const where: FindOptionsWhere<NginxServiceEntity> = { deletedAt: IsNull() };
    if (serverId) {
      where.serverId = serverId;
    }
    const rows = await this.serviceRepo.find({ where, relations: { server: true }, order: { updatedAt: 'DESC' } });
    const releases = await this.releaseRepo.find({
      where: { deletedAt: IsNull() },
      order: { publishedAt: 'DESC' },
    });
    const serverDtos = new Map<string, ServerDto>();
    const items: NginxServiceSummary[] = [];
    for (const row of rows) {
      if (!serverDtos.has(row.serverId)) {
        serverDtos.set(row.serverId, await this.serversService.get(row.serverId));
      }
      const related = releases.filter((item) => item.serviceId === row.id);
      items.push(this.toSummary(row, serverDtos.get(row.serverId)!, related));
    }
    return { items };
  }

  async get(id: string): Promise<NginxServiceDetail> {
    const row = await this.findService(id);
    const server = await this.serversService.get(row.serverId);
    const releases = await this.releaseRepo.find({
      where: { serviceId: row.id, deletedAt: IsNull() },
      order: { publishedAt: 'DESC' },
    });
    return { ...this.toSummary(row, server, releases), configText: row.configText };
  }

  async create(dto: CreateNginxServiceDto): Promise<NginxServiceDetail> {
    const server = await this.serversService.get(dto.serverId);
    const name = this.assertName(dto.name);
    const port = this.assertPort(dto.port);
    const configPath = assertSafeRemoteConfPath(dto.configPath);
    const configText = this.assertConfigText(dto.configText);
    const restartCommand = assertRestartCommand(dto.restartCommand);
    await this.assertUnique(server.id, { name, port, configPath });

    const row = this.serviceRepo.create({
      id: randomUUID(),
      serverId: server.id,
      name,
      port,
      configPath,
      configText,
      restartCommand,
      archiveObjectKey: null,
      archiveUploadedAt: null,
      currentReleaseId: null,
      deletedAt: null,
    });
    await this.serviceRepo.save(row);
    const warning = await this.syncWorkingCopy(row);
    await this.serviceRepo.save(row);
    const detail = await this.get(row.id);
    return warning ? { ...detail, warning } : detail;
  }

  async update(id: string, dto: UpdateNginxServiceDto): Promise<NginxServiceDetail> {
    const row = await this.findService(id);
    const serverId = dto.serverId ?? row.serverId;
    await this.serversService.get(serverId);
    const name = dto.name !== undefined ? this.assertName(dto.name) : row.name;
    const port = dto.port !== undefined ? this.assertPort(dto.port) : row.port;
    const configPath = dto.configPath !== undefined ? assertSafeRemoteConfPath(dto.configPath) : row.configPath;
    const configText = dto.configText !== undefined ? this.assertConfigText(dto.configText) : row.configText;
    const restartCommand =
      dto.restartCommand !== undefined ? assertRestartCommand(dto.restartCommand) : assertRestartCommand(row.restartCommand);

    await this.assertUnique(serverId, { name, port, configPath }, row.id);
    const textChanged = configText !== row.configText;
    row.serverId = serverId;
    row.name = name;
    row.port = port;
    row.configPath = configPath;
    row.configText = configText;
    row.restartCommand = restartCommand;
    await this.serviceRepo.save(row);
    const warning = textChanged || !row.archiveObjectKey ? await this.syncWorkingCopy(row) : undefined;
    if (warning !== undefined || row.archiveObjectKey) {
      await this.serviceRepo.save(row);
    }
    const detail = await this.get(row.id);
    return warning ? { ...detail, warning } : detail;
  }

  async softDelete(id: string): Promise<{ ok: true; id: string }> {
    const row = await this.findService(id);
    row.deletedAt = new Date();
    await this.serviceRepo.save(row);
    return { ok: true, id: row.id };
  }

  async listReleases(serviceId: string): Promise<{ items: NginxReleaseDetail[] }> {
    const service = await this.findService(serviceId);
    const rows = await this.releaseRepo.find({
      where: { serviceId: service.id, deletedAt: IsNull() },
      order: { publishedAt: 'DESC' },
    });
    return { items: rows.map((row) => this.toReleaseDto(row, service, rows, false)) };
  }

  async getRelease(serviceId: string, releaseId: string): Promise<NginxReleaseDetail> {
    const service = await this.findService(serviceId);
    const row = await this.findRelease(service.id, releaseId);
    const siblings = await this.releaseRepo.find({
      where: { serviceId: service.id, deletedAt: IsNull() },
    });
    return this.toReleaseDto(row, service, siblings, true);
  }

  async updateRelease(serviceId: string, releaseId: string, remark: string): Promise<NginxReleaseDetail> {
    const service = await this.findService(serviceId);
    const row = await this.findRelease(service.id, releaseId);
    const next = this.assertRemark(remark);
    row.remark = next;
    await this.releaseRepo.save(row);
    return this.getRelease(service.id, row.id);
  }

  async softDeleteRelease(serviceId: string, releaseId: string): Promise<{ ok: true; id: string }> {
    const service = await this.findService(serviceId);
    const row = await this.findRelease(service.id, releaseId);
    row.deletedAt = new Date();
    await this.releaseRepo.save(row);
    if (service.currentReleaseId === row.id) {
      const written = await this.releaseRepo.find({
        where: { serviceId: service.id, deletedAt: IsNull(), written: true },
        order: { publishedAt: 'DESC' },
      });
      service.currentReleaseId = written[0]?.id ?? null;
      await this.serviceRepo.save(service);
    }
    return { ok: true, id: row.id };
  }

  async openReleaseDownload(serviceId: string, releaseId: string): Promise<{
    stream: Readable;
    filename: string;
    contentType: string;
    contentDisposition: string;
  }> {
    const service = await this.findService(serviceId);
    const row = await this.findRelease(service.id, releaseId);
    const fileName = this.releaseFileName(service, row);
    return {
      stream: Readable.from(Buffer.from(row.configText, 'utf8')),
      filename: fileName,
      contentType: 'text/plain; charset=utf-8',
      contentDisposition: buildContentDisposition(fileName),
    };
  }

  async publish(serviceId: string, dto: PublishNginxServiceDto): Promise<NginxReleaseDetail> {
    const service = await this.findService(serviceId);
    const version = this.assertVersion(dto.version);
    const remark = this.assertRemark(dto.remark);
    await this.assertVersionAvailable(service.id, version);
    return this.runPublish(service, {
      version,
      remark,
      configText: service.configText,
      sourceReleaseId: null,
      trustHostKey: dto.trustHostKey,
    });
  }

  async republish(serviceId: string, releaseId: string, trustHostKey?: boolean): Promise<NginxReleaseDetail> {
    const service = await this.findService(serviceId);
    const source = await this.findRelease(service.id, releaseId);
    return this.runPublish(service, {
      version: source.version,
      remark: `重新发布版本 ${source.version}${source.remark ? `：${source.remark}` : ''}`,
      configText: source.configText,
      sourceReleaseId: source.id,
      trustHostKey,
    });
  }

  async restart(
    serviceId: string,
    trustHostKey?: boolean,
  ): Promise<{
    ok: boolean;
    command: string;
    destination: string;
    exitCode: number | null;
    stdout: string;
    stderr: string;
    message: string;
  }> {
    const service = await this.findService(serviceId);
    const command = assertRestartCommand(service.restartCommand);
    const server = await this.serversService.get(service.serverId);
    if (!server.sshReady) {
      throw new BadRequestException(server.sshReadyReason ?? '尚未配置远程登录，无法在目标服务器上执行重启命令。');
    }
    const resolved = await this.serversService.resolveConnection(service.serverId, { trustHostKey });
    const destination = formatRemoteDestination({
      username: resolved.connection.username,
      host: resolved.connection.host,
      port: resolved.connection.port,
      path: service.configPath,
    });
    const outcome = await this.ssh.execCommand({
      connection: resolved.connection,
      pinnedHostKey: trustHostKey ? null : resolved.pinnedHostKey,
      trustNewHostKey: Boolean(trustHostKey),
      command,
    });
    if (outcome.newlyTrusted) {
      await this.serversService.pinHostKey(service.serverId, outcome.hostKey);
    }
    const failed = outcome.result.exitCode !== 0;
    const outputHint = this.formatCommandOutput(outcome.result.stdout, outcome.result.stderr);
    return {
      ok: !failed,
      command,
      destination,
      exitCode: outcome.result.exitCode,
      stdout: outcome.result.stdout,
      stderr: outcome.result.stderr,
      message: failed
        ? `已在 ${destination} 执行「${command}」，但退出码为 ${outcome.result.exitCode ?? '未知'}。${outputHint}`.trim()
        : `已在 ${destination} 执行「${command}」，远程服务重启命令已成功完成。`,
    };
  }

  private async runPublish(
    service: NginxServiceEntity,
    options: {
      version: string;
      remark: string;
      configText: string;
      sourceReleaseId: string | null;
      trustHostKey?: boolean;
    },
  ): Promise<NginxReleaseDetail> {
    const command = assertRestartCommand(service.restartCommand);
    const configPath = assertSafeRemoteConfPath(service.configPath);
    const configText = this.assertConfigText(options.configText);
    const server = await this.serversService.get(service.serverId);
    if (!server.sshReady) {
      throw new BadRequestException(server.sshReadyReason ?? '尚未配置远程登录，无法将配置发布到服务器。');
    }

    const resolved = await this.serversService.resolveConnection(service.serverId, {
      trustHostKey: options.trustHostKey,
    });
    const remote = {
      host: resolved.connection.host,
      port: resolved.connection.port,
      username: resolved.connection.username,
      path: configPath,
    };
    const release = this.releaseRepo.create({
      id: randomUUID(),
      serviceId: service.id,
      version: options.version,
      remark: options.remark,
      configText,
      configPath,
      archiveObjectKey: null,
      archiveUploadedAt: null,
      sourceReleaseId: options.sourceReleaseId,
      status: 'failed',
      publishedAt: new Date(),
      written: false,
      restartCommandUsed: command,
      restartExecuted: false,
      restartExitCode: null,
      restartStdout: null,
      restartStderr: null,
      errorMessage: null,
      remoteHost: remote.host,
      remotePort: remote.port,
      remoteUsername: remote.username,
      rustfsSynced: false,
      deletedAt: null,
    });

    const snapshotWarning = await this.syncReleaseCopy(service, release);

    try {
      const written = await this.ssh.writeRemoteFile({
        connection: resolved.connection,
        pinnedHostKey: options.trustHostKey ? null : resolved.pinnedHostKey,
        trustNewHostKey: Boolean(options.trustHostKey),
        remoteFilePath: configPath,
        body: configText,
        mode: 0o644,
      });
      if (written.newlyTrusted) {
        await this.serversService.pinHostKey(service.serverId, written.hostKey);
      }
      release.written = true;
      release.configPath = written.result.path;
    } catch (error) {
      const message = error instanceof Error ? error.message : '远程写入配置文件失败。';
      release.status = 'failed';
      release.written = false;
      release.errorMessage = message;
      await this.releaseRepo.save(release);
      throw error;
    }

    let restartWarning: string | undefined;
    try {
      const restarted = await this.ssh.execCommand({
        connection: resolved.connection,
        pinnedHostKey: resolved.pinnedHostKey,
        trustNewHostKey: false,
        command,
      });
      if (restarted.newlyTrusted) {
        await this.serversService.pinHostKey(service.serverId, restarted.hostKey);
      }
      release.restartExecuted = true;
      release.restartExitCode = restarted.result.exitCode;
      release.restartStdout = restarted.result.stdout || null;
      release.restartStderr = restarted.result.stderr || null;
      if (restarted.result.exitCode !== 0) {
        release.status = 'partial';
        release.errorMessage = `配置文件已覆盖到 ${formatRemoteDestination({
          username: remote.username,
          host: remote.host,
          port: remote.port,
          path: release.configPath,
        })}，但重启命令「${command}」执行失败（退出码 ${restarted.result.exitCode}）。服务可能尚未加载新配置，请检查后可手动重启。${this.formatCommandOutput(restarted.result.stdout, restarted.result.stderr)}`.trim();
        restartWarning = release.errorMessage;
      } else {
        release.status = 'success';
        release.errorMessage = snapshotWarning ?? null;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : '远程重启命令执行失败。';
      release.status = 'partial';
      release.restartExecuted = false;
      release.errorMessage = `配置文件已覆盖到 ${formatRemoteDestination({
        username: remote.username,
        host: remote.host,
        port: remote.port,
        path: release.configPath,
      })}，但重启命令「${command}」未能执行：${message}。服务可能尚未加载新配置，请检查后可手动重启。`;
      restartWarning = release.errorMessage;
    }

    await this.releaseRepo.save(release);
    service.currentReleaseId = release.id;
    if (options.sourceReleaseId) {
      service.configText = configText;
      await this.syncWorkingCopy(service);
    }
    await this.serviceRepo.save(service);
    const detail = await this.getRelease(service.id, release.id);
    const warning = [snapshotWarning, restartWarning].filter(Boolean).join(' ');
    return warning ? { ...detail, warning } : detail;
  }

  private async syncWorkingCopy(row: NginxServiceEntity): Promise<string | undefined> {
    try {
      this.rustfs.assertReady();
      const stored = await this.rustfs.putObject(
        buildNginxServiceObjectKey(row.id, this.workingCopyFileName(row)),
        row.configText,
        'text/plain; charset=utf-8',
      );
      row.archiveObjectKey = stored.key;
      row.archiveUploadedAt = new Date();
      return undefined;
    } catch (error) {
      return `服务配置已保存，但文件服务器中的管理副本未能更新：${error instanceof Error ? error.message : '未知错误'}。这不会影响之后向服务器发布，但管理档案可能不完整。`;
    }
  }

  private async syncReleaseCopy(service: NginxServiceEntity, release: NginxServiceReleaseEntity): Promise<string | undefined> {
    try {
      this.rustfs.assertReady();
      const stored = await this.rustfs.putObject(
        buildNginxReleaseObjectKey(service.id, release.id, this.releaseFileName(service, release)),
        release.configText,
        'text/plain; charset=utf-8',
      );
      release.archiveObjectKey = stored.key;
      release.archiveUploadedAt = new Date();
      release.rustfsSynced = true;
      return undefined;
    } catch (error) {
      release.rustfsSynced = false;
      return `发布记录已创建，但文件服务器中的版本快照未能保存：${error instanceof Error ? error.message : '未知错误'}。`;
    }
  }

  private async assertUnique(
    serverId: string,
    values: { name: string; port: number; configPath: string },
    excludeId?: string,
  ): Promise<void> {
    const siblings = await this.serviceRepo.find({ where: { serverId, deletedAt: IsNull() } });
    const others = siblings.filter((item) => item.id !== excludeId);
    if (others.some((item) => item.name === values.name)) {
      throw new ConflictException(`该服务器下已有名为「${values.name}」的服务。同一服务器下名称必须唯一。`);
    }
    if (others.some((item) => item.port === values.port)) {
      throw new ConflictException(`该服务器下已有端口为 ${values.port} 的服务。同一服务器下端口必须唯一。`);
    }
    if (others.some((item) => item.configPath === values.configPath)) {
      throw new ConflictException(
        `该服务器下已有配置路径「${values.configPath}」的服务。同一服务器下 Nginx 配置文件路径必须唯一。`,
      );
    }
  }

  private async assertVersionAvailable(serviceId: string, version: string, excludeId?: string): Promise<void> {
    const existing = await this.releaseRepo.find({
      where: { serviceId, version, deletedAt: IsNull(), sourceReleaseId: IsNull() },
    });
    if (existing.some((item) => item.id !== excludeId)) {
      throw new ConflictException(`该服务下已有版本号「${version}」。同一服务下未删除的版本号不能重复；重新发布请使用「重新发布」而不是新建相同版本号。`);
    }
  }

  private async findService(id: string): Promise<NginxServiceEntity> {
    const row = await this.serviceRepo.findOne({ where: { id }, relations: { server: true } });
    if (!row || row.deletedAt) {
      throw new NotFoundException('未找到该 Nginx 服务。');
    }
    return row;
  }

  private async findRelease(serviceId: string, releaseId: string): Promise<NginxServiceReleaseEntity> {
    const row = await this.releaseRepo.findOne({ where: { id: releaseId, serviceId } });
    if (!row || row.deletedAt) {
      throw new NotFoundException('未找到该发布记录。');
    }
    return row;
  }

  private assertName(raw: string): string {
    const name = raw.trim();
    if (!name) {
      throw new BadRequestException('请填写服务名称。');
    }
    return name;
  }

  private assertPort(port: number): number {
    if (!Number.isInteger(port) || port < 1 || port > 65535) {
      throw new BadRequestException('端口必须是 1 到 65535 之间的整数。');
    }
    return port;
  }

  private assertConfigText(raw: string): string {
    const text = raw.replace(/^\uFEFF/, '');
    if (!text.trim()) {
      throw new BadRequestException('请填写 Nginx 配置文件内容。');
    }
    if (text.length > 262144) {
      throw new BadRequestException('配置文件内容过长，请控制在 256 KB 以内。');
    }
    return text;
  }

  private assertRemark(raw: string): string {
    const remark = raw.trim();
    if (!remark) {
      throw new BadRequestException('请填写发布备注。');
    }
    if (remark.length > 500) {
      throw new BadRequestException('备注请控制在 500 个字符以内。');
    }
    return remark;
  }

  private assertVersion(raw: string): string {
    const version = raw.trim();
    if (!version) {
      throw new BadRequestException('请填写版本号。');
    }
    if (version.length > 64) {
      throw new BadRequestException('版本号请控制在 64 个字符以内。');
    }
    if (!VERSION_PATTERN.test(version)) {
      throw new BadRequestException('版本号仅支持字母、数字、点、下划线、加号和短横线。');
    }
    return version;
  }

  private workingCopyFileName(service: NginxServiceEntity): string {
    const base = service.configPath.split('/').pop() || 'current.conf';
    return base.toLowerCase().endsWith('.conf') ? base : 'current.conf';
  }

  private releaseFileName(service: NginxServiceEntity, release: Pick<NginxServiceReleaseEntity, 'version' | 'configPath'>): string {
    const base = (release.configPath || service.configPath).split('/').pop()?.replace(/\.conf$/i, '') || service.name;
    const version = release.version.replace(/[^A-Za-z0-9._+-]+/g, '-') || 'release';
    return `${base}-${version}.conf`;
  }

  private formatCommandOutput(stdout: string, stderr: string): string {
    const parts = [
      stdout.trim() ? `标准输出：${stdout.trim()}` : '',
      stderr.trim() ? `标准错误：${stderr.trim()}` : '',
    ].filter(Boolean);
    return parts.join(' ');
  }

  private toSummary(row: NginxServiceEntity, server: ServerDto, releases: NginxServiceReleaseEntity[]): NginxServiceSummary {
    const visible = releases.filter((item) => !item.deletedAt);
    const current = visible.find((item) => item.id === row.currentReleaseId) ?? null;
    return {
      id: row.id,
      server: {
        id: server.id,
        name: server.name,
        host: server.host,
        sshPort: server.sshPort,
        sshUsername: server.sshUsername,
        sshReady: server.sshReady,
        sshReadyReason: server.sshReadyReason,
      },
      name: row.name,
      port: row.port,
      configPath: row.configPath,
      restartCommand: row.restartCommand,
      archive: {
        storageKind: 'nginx',
        storageLabel: 'Nginx 配置管理副本',
        uploaded: Boolean(row.archiveUploadedAt && row.archiveObjectKey),
        objectKey: row.archiveObjectKey,
        uploadedAt: row.archiveUploadedAt ? row.archiveUploadedAt.toISOString() : null,
      },
      currentRelease: current
        ? {
            id: current.id,
            version: current.version,
            remark: current.remark,
            status: current.status,
            statusLabel: statusLabel(current.status),
            publishedAt: current.publishedAt.toISOString(),
            sourceReleaseId: current.sourceReleaseId,
            configPath: current.configPath,
          }
        : null,
      releaseCount: visible.length,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  private toReleaseDto(
    row: NginxServiceReleaseEntity,
    service: NginxServiceEntity,
    siblings: NginxServiceReleaseEntity[],
    includeConfig: boolean,
  ): NginxReleaseDetail {
    const source = row.sourceReleaseId
      ? siblings.find((item) => item.id === row.sourceReleaseId) ?? null
      : null;
    const dto: NginxReleaseDetail = {
      id: row.id,
      serviceId: service.id,
      serviceName: service.name,
      version: row.version,
      remark: row.remark,
      configPath: row.configPath,
      sourceReleaseId: row.sourceReleaseId,
      sourceVersion: source?.version ?? (row.sourceReleaseId ? row.version : null),
      status: row.status,
      statusLabel: statusLabel(row.status),
      publishedAt: row.publishedAt.toISOString(),
      written: row.written,
      restartCommandUsed: row.restartCommandUsed,
      restartExecuted: row.restartExecuted,
      restartExitCode: row.restartExitCode,
      restartStdout: row.restartStdout,
      restartStderr: row.restartStderr,
      errorMessage: row.errorMessage,
      rustfsSynced: row.rustfsSynced,
      archive: {
        storageKind: 'nginx',
        storageLabel: 'Nginx 配置管理副本',
        uploaded: Boolean(row.archiveUploadedAt && row.archiveObjectKey),
        objectKey: row.archiveObjectKey,
        uploadedAt: row.archiveUploadedAt ? row.archiveUploadedAt.toISOString() : null,
      },
      remote:
        row.remoteHost && row.remoteUsername
          ? {
              host: row.remoteHost,
              port: row.remotePort ?? 22,
              username: row.remoteUsername,
              path: row.configPath,
              destination: formatRemoteDestination({
                username: row.remoteUsername,
                host: row.remoteHost,
                port: row.remotePort,
                path: row.configPath,
              }),
            }
          : null,
    };
    if (includeConfig) {
      dto.configText = row.configText;
    }
    if (row.status === 'partial' && row.errorMessage) {
      dto.warning = row.errorMessage;
    }
    return dto;
  }
}
