import { Injectable } from '@nestjs/common';
import { Client, type SFTPWrapper } from 'ssh2';
import { parseHostKeyInfo } from './ssh-host-key';
import { isNotFoundError, wrapSftpError, wrapSshError } from './ssh.errors';
import type { RemoteDirEntry, RemoteExecResult, RemoteStat, SshClientFactory, SshConnectInput, SshSession } from './ssh.types';

const MAX_EXEC_OUTPUT = 4000;

function collectOutput(chunk: Buffer | string, current: string): string {
  if (current.length >= MAX_EXEC_OUTPUT) {
    return current;
  }
  const next = current + (typeof chunk === 'string' ? chunk : chunk.toString('utf8'));
  return next.length > MAX_EXEC_OUTPUT ? `${next.slice(0, MAX_EXEC_OUTPUT)}
…（输出已截断）` : next;
}

@Injectable()
export class Ssh2ClientFactory implements SshClientFactory {
  async connect(input: SshConnectInput): Promise<SshSession> {
    const client = new Client();
    try {
      await new Promise<void>((resolve, reject) => {
        let hostKeyError: unknown;
        const fail = (error: unknown) => {
          if (hostKeyError) {
            reject(hostKeyError);
            return;
          }
          try {
            wrapSshError(error, { host: input.host, port: input.port });
          } catch (wrapped) {
            reject(wrapped);
          }
        };
        const onError = (error: unknown) => {
          cleanup();
          fail(error);
        };
        const onReady = () => {
          cleanup();
          resolve();
        };
        const cleanup = () => {
          client.removeListener('error', onError);
          client.removeListener('ready', onReady);
        };
        client.once('error', onError);
        client.once('ready', onReady);
        client.connect({
          host: input.host,
          port: input.port,
          username: input.username,
          password: input.password,
          privateKey: input.privateKey,
          passphrase: input.passphrase,
          readyTimeout: input.timeoutMs,
          keepaliveInterval: 0,
          hostVerifier: (key: Buffer) => {
            try {
              return input.verifyHostKey(parseHostKeyInfo(key));
            } catch (error) {
              hostKeyError = error;
              return false;
            }
          },
        });
      });
    } catch (error) {
      client.end();
      throw error;
    }

    const sftp = await new Promise<SFTPWrapper>((resolve, reject) => {
      client.sftp((error, handle) => {
        if (error || !handle) {
          client.end();
          try {
            wrapSftpError(error ?? new Error('无法打开 SFTP 会话'));
          } catch (wrapped) {
            reject(wrapped);
          }
          return;
        }
        resolve(handle);
      });
    });

    return new Ssh2Session(client, sftp, { host: input.host, port: input.port });
  }
}

class Ssh2Session implements SshSession {
  constructor(
    private readonly client: Client,
    private readonly sftp: SFTPWrapper,
    private readonly context: { host: string; port: number },
  ) {}

  async stat(remotePath: string): Promise<RemoteStat | null> {
    return new Promise((resolve, reject) => {
      this.sftp.stat(remotePath, (error, stats) => {
        if (error) {
          if (isNotFoundError(error)) {
            resolve(null);
            return;
          }
          try {
            wrapSftpError(error, remotePath);
          } catch (wrapped) {
            reject(wrapped);
          }
          return;
        }
        resolve({
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          size: stats.size,
          mtime: stats.mtime ? new Date(Number(stats.mtime) * 1000) : undefined,
        });
      });
    });
  }

  async readdir(remotePath: string): Promise<RemoteDirEntry[]> {
    return new Promise((resolve, reject) => {
      this.sftp.readdir(remotePath, (error, list) => {
        if (error) {
          try {
            wrapSftpError(error, remotePath);
          } catch (wrapped) {
            reject(wrapped);
          }
          return;
        }
        resolve(
          (list ?? []).map((item) => ({
            fileName: item.filename,
            size: item.attrs.size,
            isDirectory: item.attrs.isDirectory(),
            isFile: item.attrs.isFile(),
            mtime: item.attrs.mtime ? new Date(Number(item.attrs.mtime) * 1000) : undefined,
          })),
        );
      });
    });
  }

  async writeFile(remotePath: string, body: Buffer | string, mode?: number): Promise<void> {
    const data = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    return new Promise((resolve, reject) => {
      const stream = this.sftp.createWriteStream(remotePath, mode ? { mode } : undefined);
      const onError = (error: unknown) => {
        cleanup();
        try {
          wrapSftpError(error, remotePath);
        } catch (wrapped) {
          reject(wrapped);
        }
      };
      const onClose = () => {
        cleanup();
        resolve();
      };
      const cleanup = () => {
        stream.removeListener('error', onError);
        stream.removeListener('close', onClose);
      };
      stream.once('error', onError);
      stream.once('close', onClose);
      stream.end(data);
    });
  }

  async exec(command: string): Promise<RemoteExecResult> {
    return new Promise((resolve, reject) => {
      this.client.exec(command, (error, stream) => {
        if (error || !stream) {
          try {
            wrapSshError(error ?? new Error('无法在远程主机执行命令'), this.context);
          } catch (wrapped) {
            reject(wrapped);
          }
          return;
        }
        let stdout = '';
        let stderr = '';
        stream.on('data', (chunk: Buffer | string) => {
          stdout = collectOutput(chunk, stdout);
        });
        stream.stderr.on('data', (chunk: Buffer | string) => {
          stderr = collectOutput(chunk, stderr);
        });
        stream.on('close', (code: number | null, signal?: string) => {
          resolve({
            exitCode: typeof code === 'number' ? code : null,
            signal,
            stdout,
            stderr,
          });
        });
        stream.on('error', (streamError: unknown) => {
          try {
            wrapSshError(streamError, this.context);
          } catch (wrapped) {
            reject(wrapped);
          }
        });
      });
    });
  }

  end(): void {
    try {
      this.sftp.end();
    } catch {
      // 关闭时忽略底层错误，避免掩盖业务结果。
    }
    this.client.end();
  }
}
