import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { normalizeDeployPath } from '../storage/object-key';
import {
  CreateServerDto,
  CreateServerPathDto,
  UpdateServerDto,
  UpdateServerPathDto,
} from './dto/server.dto';
import { ServerPathEntity } from './entities/server-path.entity';
import { ServerEntity } from './entities/server.entity';

@Injectable()
export class ServersService {
  constructor(
    @InjectRepository(ServerEntity)
    private readonly serverRepo: Repository<ServerEntity>,
    @InjectRepository(ServerPathEntity)
    private readonly pathRepo: Repository<ServerPathEntity>,
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
    });
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
    const row = await this.findServer(id);
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

  async count(): Promise<number> {
    return this.serverRepo.count();
  }

  private normalizePathInput(raw: string): string {
    const trimmed = raw.trim();
    // Keep the user-facing path mostly as entered, but reject traversal.
    normalizeDeployPath(trimmed);
    if (trimmed.includes('\0')) {
      throw new ConflictException('部署路径无效。');
    }
    return trimmed.replace(/\\/g, '/').replace(/\/+/g, '/');
  }

  private toDto(row: ServerEntity) {
    return {
      id: row.id,
      name: row.name,
      host: row.host,
      description: row.description,
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
