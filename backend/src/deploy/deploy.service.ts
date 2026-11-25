import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import path from 'node:path';
import { Repository } from 'typeorm';
import { CaService } from '../ca/ca.service';
import { CertsService } from '../certs/certs.service';
import { ServersService } from '../servers/servers.service';
import { buildObjectKey, buildObjectPrefix } from '../storage/object-key';
import { assertSafeObjectKey, isForbiddenUploadName } from '../storage/upload-guard';
import { RustfsService } from '../storage/rustfs.service';
import { DeployRecordEntity, type DeployedFile, type DeployedFileKind } from './deploy-record.entity';
import { CreateDeployDto } from './dto/create-deploy.dto';

@Injectable()
export class DeployService {
  constructor(
    @InjectRepository(DeployRecordEntity)
    private readonly repo: Repository<DeployRecordEntity>,
    private readonly certsService: CertsService,
    private readonly serversService: ServersService,
    private readonly rustfs: RustfsService,
    private readonly caService: CaService,
  ) {}

  async list() {
    const items = await this.repo.find({
      relations: { certificate: true, server: true, path: true },
      order: { createdAt: 'DESC' },
    });
    return { items: items.map((item) => this.toDto(item)) };
  }

  async get(id: string) {
    const row = await this.repo.findOne({
      where: { id },
      relations: { certificate: true, server: true, path: true },
    });
    if (!row) {
      throw new NotFoundException('未找到该上传记录。');
    }
    return this.toDto(row);
  }

  async listTargetFiles(serverId: string, pathId: string) {
    const server = await this.serversService.findServer(serverId);
    const deployPath = await this.serversService.findPath(serverId, pathId);
    const prefix = buildObjectPrefix(server.name, deployPath.path);
    const files = await this.rustfs.listPrefix(prefix);
    const latest = await this.repo.findOne({
      where: { serverId, pathId },
      order: { createdAt: 'DESC' },
      relations: { certificate: true, server: true, path: true },
    });
    return {
      server: { id: server.id, name: server.name, host: server.host },
      path: { id: deployPath.id, path: deployPath.path, label: deployPath.label },
      prefix,
      files: files.map((file) => ({
        ...file,
        fileName: file.key.slice(prefix.length + 1),
        kind: this.guessKind(file.key),
      })),
      latestDeploy: latest ? this.toDto(latest) : null,
    };
  }

  async deploy(dto: CreateDeployDto) {
    this.rustfs.assertReady();
    const certificate = await this.certsService.findRecord(dto.certificateId);
    const server = await this.serversService.findServer(dto.serverId);
    const deployPath = await this.serversService.findPath(dto.serverId, dto.pathId);
    const material = await this.certsService.readLocalMaterial(certificate.name);

    const planned: Array<{ kind: DeployedFileKind; fileName: string; body: string; contentType: string }> = [
      {
        kind: 'server-cert',
        fileName: certificate.publicFileName,
        body: material.certPem,
        contentType: 'application/x-x509-ca-cert',
      },
      {
        kind: 'server-key',
        fileName: certificate.keyFileName,
        body: material.keyPem,
        contentType: 'application/x-pem-file',
      },
    ];

    if (dto.includeRootCaCert) {
      const caPem = await this.caService.readCertificatePem();
      const caName = await this.caService.getPublicFileName();
      planned.push({
        kind: 'ca-cert',
        fileName: caName,
        body: caPem,
        contentType: 'application/x-x509-ca-cert',
      });
    }

    for (const item of planned) {
      if (isForbiddenUploadName(item.fileName)) {
        throw new BadRequestException(
          '禁止上传 rootCA.key。根 CA 私钥不会出现在部署包或文件服务器中。',
        );
      }
    }

    const prefix = buildObjectPrefix(server.name, deployPath.path);
    const keys = planned.map((item) => buildObjectKey(server.name, deployPath.path, item.fileName));

    if (!dto.overwrite) {
      const existing: string[] = [];
      for (const key of keys) {
        if (await this.rustfs.objectExists(key)) {
          existing.push(key);
        }
      }
      if (existing.length > 0) {
        throw new ConflictException(
          `目标路径下已有文件：${existing.join('，')}。如需覆盖，请确认后开启覆盖选项。`,
        );
      }
    }

    const uploaded: DeployedFile[] = [];
    for (const item of planned) {
      const objectKey = buildObjectKey(server.name, deployPath.path, item.fileName);
      const stored = await this.rustfs.putObject(objectKey, item.body, item.contentType);
      uploaded.push({
        kind: item.kind,
        fileName: item.fileName,
        objectKey: stored.key,
        size: stored.size,
      });
    }

    const record = this.repo.create({
      certificateId: certificate.id,
      serverId: server.id,
      pathId: deployPath.id,
      objectPrefix: prefix,
      files: uploaded,
      overwritten: Boolean(dto.overwrite),
    });
    await this.repo.save(record);
    return this.get(record.id);
  }

  async openStoredFile(objectKey: string) {
    const key = assertSafeObjectKey(objectKey);
    return this.rustfs.getObjectStream(key);
  }

  private guessKind(objectKey: string): DeployedFileKind | 'unknown' {
    const base = path.posix.basename(objectKey);
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

  private toDto(row: DeployRecordEntity) {
    return {
      id: row.id,
      certificate: row.certificate
        ? {
            id: row.certificate.id,
            name: row.certificate.name,
            commonName: row.certificate.commonName,
            publicFileName: row.certificate.publicFileName,
            keyFileName: row.certificate.keyFileName,
          }
        : { id: row.certificateId },
      server: row.server
        ? { id: row.server.id, name: row.server.name, host: row.server.host }
        : { id: row.serverId },
      path: row.path
        ? { id: row.path.id, path: row.path.path, label: row.path.label }
        : { id: row.pathId },
      objectPrefix: row.objectPrefix,
      files: row.files,
      overwritten: row.overwritten,
      createdAt: row.createdAt.toISOString(),
      warning:
        '上传内容面向目标服务器的部署目录。server.key 只用于部署到对应 Nginx，不要分发给客户端。rootCA.key 从未上传。当前是写入 RustFS 对象存储中的服务器/路径前缀，而不是通过 SSH 直接写入远程磁盘。',
    };
  }
}
