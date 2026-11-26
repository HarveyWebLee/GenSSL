import { BadRequestException } from '@nestjs/common';
import { parseHostKeyInfo } from './ssh-host-key';
import type {
  HostKeyInfo,
  RemoteDirEntry,
  RemoteExecResult,
  RemoteStat,
  SshClientFactory,
  SshConnectInput,
  SshSession,
} from './ssh.types';

export interface MemoryRemoteFile {
  body: Buffer;
  mode: number;
  mtime: Date;
}

function normalize(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+$/, '') || '/';
}

function parentOf(path: string): string {
  const norm = normalize(path);
  const index = norm.lastIndexOf('/');
  if (index <= 0) {
    return '/';
  }
  return norm.slice(0, index);
}

function fileNameOf(path: string): string {
  const norm = normalize(path);
  return norm.split('/').pop() || norm;
}

export class MemorySshWorld {
  directories = new Set<string>(['/']);
  files = new Map<string, MemoryRemoteFile>();
  hostKeys = new Map<string, Buffer>();
  expectedUsername?: string;
  expectedPassword?: string;
  expectedPrivateKey?: string;
  connectError?: unknown;
  writeError?: unknown;
  execError?: unknown;
  execResult: RemoteExecResult = { exitCode: 0, stdout: '', stderr: '' };
  executedCommands: string[] = [];

  hostKeyFor(host: string, port: number): Buffer {
    const key = `${host}:${port}`;
    const existing = this.hostKeys.get(key);
    if (existing) {
      return existing;
    }
    const algo = Buffer.from('ssh-ed25519');
    const header = Buffer.alloc(4);
    header.writeUInt32BE(algo.length);
    const generated = Buffer.concat([header, algo, Buffer.from(`memory-host-key:${key}`)]);
    this.hostKeys.set(key, generated);
    return generated;
  }

  addDirectory(path: string): void {
    const norm = normalize(path);
    const parts = norm.split('/');
    let current = '';
    for (const part of parts) {
      if (!part || part === ':') {
        if (part === ':') {
          continue;
        }
        // 保留 Windows 盘符段
      }
      current = current ? `${current}/${part}` : part.includes(':') ? part : `/${part}`;
      if (current === '') {
        current = '/';
      }
      this.directories.add(normalize(current.startsWith('/') || current.includes(':') ? current : `/${current}`));
    }
    this.directories.add(norm);
  }

  addFile(path: string, body: string | Buffer = '', mode = 0o644): void {
    const norm = normalize(path);
    this.addDirectory(parentOf(norm));
    this.files.set(norm, {
      body: typeof body === 'string' ? Buffer.from(body, 'utf8') : body,
      mode,
      mtime: new Date(),
    });
  }

  list(path: string): RemoteDirEntry[] {
    const dir = normalize(path);
    const prefix = dir === '/' ? '/' : `${dir}/`;
    const names = new Set<string>();
    const entries: RemoteDirEntry[] = [];
    for (const candidate of this.directories) {
      if (candidate === dir) {
        continue;
      }
      if (candidate.startsWith(prefix)) {
        const rest = candidate.slice(prefix.length);
        const name = rest.split('/')[0];
        if (name && !names.has(name) && !rest.includes('/')) {
          names.add(name);
          entries.push({ fileName: name, size: 0, isDirectory: true, isFile: false });
        }
      }
    }
    for (const [filePath, file] of this.files.entries()) {
      if (parentOf(filePath) === dir) {
        const name = fileNameOf(filePath);
        if (!names.has(name)) {
          names.add(name);
          entries.push({
            fileName: name,
            size: file.body.length,
            isDirectory: false,
            isFile: true,
            mtime: file.mtime,
          });
        }
      }
    }
    return entries;
  }
}

export class MemorySshClientFactory implements SshClientFactory {
  constructor(public readonly world: MemorySshWorld) {}

  async connect(input: SshConnectInput): Promise<SshSession> {
    if (this.world.connectError) {
      throw this.world.connectError;
    }
    if (this.world.expectedUsername && this.world.expectedUsername !== input.username) {
      throw new BadRequestException('身份验证失败，请检查用户名、密码或私钥（以及私钥口令）是否正确。');
    }
    if (this.world.expectedPassword && this.world.expectedPassword !== input.password) {
      throw new BadRequestException('身份验证失败，请检查用户名、密码或私钥（以及私钥口令）是否正确。');
    }
    if (this.world.expectedPrivateKey && this.world.expectedPrivateKey !== input.privateKey) {
      throw new BadRequestException('身份验证失败，请检查用户名、密码或私钥（以及私钥口令）是否正确。');
    }
    const peer: HostKeyInfo = parseHostKeyInfo(this.world.hostKeyFor(input.host, input.port));
    if (!input.verifyHostKey(peer)) {
      throw new BadRequestException('远程主机密钥校验失败。');
    }
    return new MemorySshSession(this.world);
  }
}

class MemorySshSession implements SshSession {
  constructor(private readonly world: MemorySshWorld) {}

  async stat(remotePath: string): Promise<RemoteStat | null> {
    const path = normalize(remotePath);
    const file = this.world.files.get(path);
    if (file) {
      return { isDirectory: false, isFile: true, size: file.body.length, mtime: file.mtime };
    }
    if (this.world.directories.has(path)) {
      return { isDirectory: true, isFile: false, size: 0 };
    }
    return null;
  }

  async readdir(remotePath: string): Promise<RemoteDirEntry[]> {
    const path = normalize(remotePath);
    if (!this.world.directories.has(path)) {
      throw new BadRequestException(`远程目录或文件不存在（${remotePath}）。请确认路径已创建，且填写的是绝对路径。`);
    }
    return this.world.list(path);
  }

  async writeFile(remotePath: string, body: Buffer | string, mode = 0o644): Promise<void> {
    if (this.world.writeError) {
      throw this.world.writeError;
    }
    const path = normalize(remotePath);
    const parent = parentOf(path);
    if (!this.world.directories.has(parent)) {
      throw new BadRequestException(`远程目录或文件不存在（${parent}）。请确认路径已创建，且填写的是绝对路径。`);
    }
    this.world.addFile(path, body, mode);
  }

  async exec(command: string): Promise<RemoteExecResult> {
    this.world.executedCommands.push(command);
    if (this.world.execError) {
      throw this.world.execError;
    }
    return { ...this.world.execResult };
  }

  end(): void {
    // 内存会话无需关闭底层连接。
  }
}
