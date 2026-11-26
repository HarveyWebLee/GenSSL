import { ConfigService } from '@nestjs/config';

export type PostgresConnectionOptions = {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
};

export type PostgresEnv = {
  POSTGRES_HOST?: string;
  POSTGRES_PORT?: string;
  POSTGRES_DB?: string;
  POSTGRES_USER?: string;
  POSTGRES_PASSWORD?: string;
  DATABASE_URL?: string;
};

export const DEFAULT_POSTGRES_CONNECTION: PostgresConnectionOptions = {
  host: '127.0.0.1',
  port: 19666,
  username: 'genssl',
  password: 'genssl',
  database: 'genssl',
};

function trim(value?: string): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

function parsePort(raw: string, source: string): number {
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`${source} 不是有效的端口号`);
  }
  return port;
}

function decodeComponent(value: string, source: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    throw new Error(`${source} 含有无效的百分号编码`);
  }
}

function normalizeHost(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

function hasPostgresVars(env: PostgresEnv): boolean {
  return Boolean(
    trim(env.POSTGRES_HOST) ||
      trim(env.POSTGRES_PORT) ||
      trim(env.POSTGRES_DB) ||
      trim(env.POSTGRES_USER) ||
      trim(env.POSTGRES_PASSWORD),
  );
}

function parseDatabaseUrl(raw: string): PostgresConnectionOptions {
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    throw new Error('DATABASE_URL 不是有效的数据库连接串');
  }

  if (parsed.protocol !== 'postgres:' && parsed.protocol !== 'postgresql:') {
    throw new Error('DATABASE_URL 必须是 postgres:// 或 postgresql:// 连接串');
  }

  const host = normalizeHost(parsed.hostname.trim());
  if (!host) {
    throw new Error('DATABASE_URL 缺少主机名');
  }

  const database = decodeComponent(parsed.pathname, 'DATABASE_URL 中的数据库名')
    .replace(/^\/+/, '')
    .trim();
  if (!database) {
    throw new Error('DATABASE_URL 缺少数据库名');
  }

  return {
    host,
    port: parsed.port ? parsePort(parsed.port, 'DATABASE_URL 中的端口') : 5432,
    username: decodeComponent(parsed.username, 'DATABASE_URL 中的用户名'),
    password: decodeComponent(parsed.password, 'DATABASE_URL 中的密码'),
    database,
  };
}

/**
 * 解析 PostgreSQL 连接参数。
 * 只要提供了任一 POSTGRES_*，即以这些独立变量为准（缺项使用开发默认值），
 * 即使同时存在 DATABASE_URL 也不再读取连接串。
 * 未提供 POSTGRES_* 时，回退到 DATABASE_URL；两者都未提供时使用开发默认值。
 */
export function resolvePostgresConnection(env: PostgresEnv = {}): PostgresConnectionOptions {
  if (hasPostgresVars(env)) {
    const port = trim(env.POSTGRES_PORT);
    return {
      host: trim(env.POSTGRES_HOST) ?? DEFAULT_POSTGRES_CONNECTION.host,
      port: port ? parsePort(port, 'POSTGRES_PORT') : DEFAULT_POSTGRES_CONNECTION.port,
      username: trim(env.POSTGRES_USER) ?? DEFAULT_POSTGRES_CONNECTION.username,
      password: trim(env.POSTGRES_PASSWORD) ?? DEFAULT_POSTGRES_CONNECTION.password,
      database: trim(env.POSTGRES_DB) ?? DEFAULT_POSTGRES_CONNECTION.database,
    };
  }

  const url = trim(env.DATABASE_URL);
  if (url) {
    return parseDatabaseUrl(url);
  }

  return { ...DEFAULT_POSTGRES_CONNECTION };
}

export function postgresConnectionFromConfig(config: ConfigService): PostgresConnectionOptions {
  return resolvePostgresConnection({
    POSTGRES_HOST: config.get<string>('POSTGRES_HOST'),
    POSTGRES_PORT: config.get<string>('POSTGRES_PORT'),
    POSTGRES_DB: config.get<string>('POSTGRES_DB'),
    POSTGRES_USER: config.get<string>('POSTGRES_USER'),
    POSTGRES_PASSWORD: config.get<string>('POSTGRES_PASSWORD'),
    DATABASE_URL: config.get<string>('DATABASE_URL'),
  });
}
