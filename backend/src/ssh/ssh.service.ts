import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { isForbiddenUploadName } from '../storage/upload-guard';
import { decideHostKey } from './ssh-host-key';
import { wrapSshError } from './ssh.errors';
import { assertSafeRemoteDirectory, joinRemoteFile } from './ssh-path';
import {
  SSH_CLIENT_FACTORY,
  type HostKeyInfo,
  type PinnedHostKey,
  type RemoteDirEntry,
  type ResolvedSshConnection,
  type SshClientFactory,
  type SshSession,
} from './ssh.types';

export interface SshOperationOptions {
  connection: ResolvedSshConnection;
  pinnedHostKey?: PinnedHostKey | null;
  trustNewHostKey?: boolean;
}

export interface SshOperationResult<T> {
  result: T;
  hostKey: HostKeyInfo;
  newlyTrusted: boolean;
}

export interface RemoteProbeFile {
  fileName: string;
  path: string;
  exists: boolean;
  size?: number;
  mtime?: Date;
}

export interface WrittenRemoteFile {
  fileName: string;
  path: string;
  size: number;
}

@Injectable()
export class SshService {
  constructor(
    @Inject(SSH_CLIENT_FACTORY)
    private readonly clientFactory: SshClientFactory,
  ) {}

  async withSession<T>(
    options: SshOperationOptions,
    fn: (session: SshSession, hostKey: HostKeyInfo) => Promise<T>,
  ): Promise<SshOperationResult<T>> {
    const { connection } = options;
    let peer: HostKeyInfo | undefined;
    let newlyTrusted = false;
    let session: SshSession | undefined;
    try {
      session = await this.clientFactory.connect({
        host: connection.host,
        port: connection.port,
        username: connection.username,
        password: connection.password,
        privateKey: connection.privateKey,
        passphrase: connection.passphrase,
        timeoutMs: connection.timeoutMs,
        verifyHostKey: (info) => {
          const decision = decideHostKey({
            pinned: options.pinnedHostKey,
            peer: info,
            trustNewHostKey: options.trustNewHostKey,
          });
          peer = decision.peer;
          newlyTrusted = decision.newlyTrusted;
          return decision.accept;
        },
      });
      if (!peer) {
        throw new BadRequestException('未能获取远程主机密钥，已中止连接。');
      }
      const result = await fn(session, peer);
      return { result, hostKey: peer, newlyTrusted };
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      wrapSshError(error, { host: connection.host, port: connection.port });
      throw error;
    } finally {
      session?.end();
    }
  }

  async testConnection(
    options: SshOperationOptions & { remotePath?: string | null },
  ): Promise<
    SshOperationResult<{
      path?: string;
      pathExists: boolean | null;
      pathListable: boolean;
      entries: RemoteDirEntry[];
    }>
  > {
    const remotePath = options.remotePath?.trim() ? assertSafeRemoteDirectory(options.remotePath) : undefined;
    return this.withSession(options, async (session) => {
      if (!remotePath) {
        return { pathExists: null, pathListable: false, entries: [] };
      }
      const stat = await session.stat(remotePath);
      if (!stat) {
        return { path: remotePath, pathExists: false, pathListable: false, entries: [] };
      }
      if (!stat.isDirectory) {
        throw new BadRequestException(`远程路径「${remotePath}」不是目录。`);
      }
      const entries = await session.readdir(remotePath);
      return { path: remotePath, pathExists: true, pathListable: true, entries };
    });
  }

  async probeFiles(
    options: SshOperationOptions & { remotePath: string; fileNames: string[] },
  ): Promise<SshOperationResult<{ directoryExists: boolean; files: RemoteProbeFile[] }>> {
    const remotePath = assertSafeRemoteDirectory(options.remotePath);
    return this.withSession(options, async (session) => {
      const directory = await session.stat(remotePath);
      if (!directory) {
        throw new BadRequestException(
          `远程目录不存在：${remotePath}。请先在服务器上创建该目录，并确认账号有写权限。测试连接不会自动创建目录。`,
        );
      }
      if (!directory.isDirectory) {
        throw new BadRequestException(`远程路径「${remotePath}」不是目录。`);
      }
      const files: RemoteProbeFile[] = [];
      for (const fileName of options.fileNames) {
        if (isForbiddenUploadName(fileName)) {
          throw new BadRequestException(
            '禁止上传 rootCA.key。根 CA 私钥只保存在数据库中，不会出现在部署目录、远程服务器或证书库中。',
          );
        }
        const path = joinRemoteFile(remotePath, fileName);
        const stat = await session.stat(path);
        files.push({
          fileName,
          path,
          exists: Boolean(stat?.isFile),
          size: stat?.size,
          mtime: stat?.mtime,
        });
      }
      return { directoryExists: true, files };
    });
  }

  async uploadFiles(
    options: SshOperationOptions & {
      remotePath: string;
      files: Array<{ fileName: string; body: string | Buffer; mode?: number }>;
    },
  ): Promise<SshOperationResult<{ written: WrittenRemoteFile[] }>> {
    const remotePath = assertSafeRemoteDirectory(options.remotePath);
    for (const file of options.files) {
      if (isForbiddenUploadName(file.fileName)) {
        throw new BadRequestException(
          '禁止上传 rootCA.key。根 CA 私钥只保存在数据库中，不会出现在部署目录、远程服务器或证书库中。',
        );
      }
    }
    return this.withSession(options, async (session) => {
      const directory = await session.stat(remotePath);
      if (!directory) {
        throw new BadRequestException(
          `远程目录不存在：${remotePath}。请先在服务器上创建该目录，并确认账号有写权限。`,
        );
      }
      if (!directory.isDirectory) {
        throw new BadRequestException(`远程路径「${remotePath}」不是目录。`);
      }
      const written: WrittenRemoteFile[] = [];
      for (const file of options.files) {
        const path = joinRemoteFile(remotePath, file.fileName);
        const body = typeof file.body === 'string' ? Buffer.from(file.body, 'utf8') : file.body;
        await session.writeFile(path, body, file.mode);
        written.push({ fileName: file.fileName, path, size: body.length });
      }
      return { written };
    });
  }

  async listDirectory(
    options: SshOperationOptions & { remotePath: string },
  ): Promise<SshOperationResult<{ exists: boolean; entries: RemoteDirEntry[] }>> {
    const remotePath = assertSafeRemoteDirectory(options.remotePath);
    return this.withSession(options, async (session) => {
      const stat = await session.stat(remotePath);
      if (!stat || !stat.isDirectory) {
        return { exists: false, entries: [] };
      }
      return { exists: true, entries: await session.readdir(remotePath) };
    });
  }
}
