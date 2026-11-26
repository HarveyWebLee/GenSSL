export type SshAuthMethod = 'password' | 'privateKey';

export const DEFAULT_SSH_PORT = 22;
export const DEFAULT_SSH_TIMEOUT_MS = 15_000;
export const SSH_CLIENT_FACTORY = 'SSH_CLIENT_FACTORY';

export interface HostKeyInfo {
  algorithm: string;
  keyBase64: string;
  fingerprint: string;
}

export interface PinnedHostKey {
  algorithm: string;
  keyBase64: string;
  fingerprint: string;
}

export interface SshConnectInput {
  host: string;
  port: number;
  username: string;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  timeoutMs: number;
  verifyHostKey: (peer: HostKeyInfo) => boolean;
}

export interface RemoteStat {
  isDirectory: boolean;
  isFile: boolean;
  size: number;
  mtime?: Date;
}

export interface RemoteDirEntry {
  fileName: string;
  size: number;
  isDirectory: boolean;
  isFile: boolean;
  mtime?: Date;
}

export interface RemoteExecResult {
  exitCode: number | null;
  signal?: string;
  stdout: string;
  stderr: string;
}

export interface SshSession {
  stat(remotePath: string): Promise<RemoteStat | null>;
  readdir(remotePath: string): Promise<RemoteDirEntry[]>;
  writeFile(remotePath: string, body: Buffer | string, mode?: number): Promise<void>;
  exec(command: string): Promise<RemoteExecResult>;
  end(): void;
}

export interface SshClientFactory {
  connect(input: SshConnectInput): Promise<SshSession>;
}

export interface SshReadiness {
  ready: boolean;
  reason: string | null;
  missing: string[];
}

export interface ResolvedSshConnection {
  host: string;
  port: number;
  username: string;
  authMethod: SshAuthMethod;
  password?: string;
  privateKey?: string;
  passphrase?: string;
  timeoutMs: number;
}

export interface HostKeyDecision {
  accept: boolean;
  newlyTrusted: boolean;
  peer: HostKeyInfo;
}
