import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { ConfigService } from '@nestjs/config';
import {
  DEFAULT_POSTGRES_CONNECTION,
  postgresConnectionFromConfig,
  resolvePostgresConnection,
} from './database.config';

describe('resolvePostgresConnection', () => {
  it('uses built-in development defaults when no env is set', () => {
    assert.deepEqual(resolvePostgresConnection({}), DEFAULT_POSTGRES_CONNECTION);
    assert.deepEqual(DEFAULT_POSTGRES_CONNECTION, {
      host: '127.0.0.1',
      port: 19666,
      username: 'genssl',
      password: 'genssl',
      database: 'genssl',
    });
  });

  it('prefers discrete POSTGRES_* variables over defaults', () => {
    assert.deepEqual(
      resolvePostgresConnection({
        POSTGRES_HOST: 'db.internal',
        POSTGRES_PORT: '5432',
        POSTGRES_DB: 'prod',
        POSTGRES_USER: 'app',
        POSTGRES_PASSWORD: 's3cret',
      }),
      {
        host: 'db.internal',
        port: 5432,
        username: 'app',
        password: 's3cret',
        database: 'prod',
      },
    );
  });

  it('fills missing POSTGRES_* fields with development defaults', () => {
    assert.deepEqual(
      resolvePostgresConnection({
        POSTGRES_PASSWORD: 'only-password',
      }),
      {
        ...DEFAULT_POSTGRES_CONNECTION,
        password: 'only-password',
      },
    );
  });

  it('treats blank POSTGRES_* values as unset and falls back to DATABASE_URL', () => {
    assert.deepEqual(
      resolvePostgresConnection({
        POSTGRES_HOST: '  ',
        POSTGRES_PORT: '',
        POSTGRES_DB: '\t',
        POSTGRES_USER: ' ',
        POSTGRES_PASSWORD: '',
        DATABASE_URL: 'postgres://alice:pw@10.0.0.8:15432/other',
      }),
      {
        host: '10.0.0.8',
        port: 15432,
        username: 'alice',
        password: 'pw',
        database: 'other',
      },
    );
  });

  it('reads DATABASE_URL when no POSTGRES_* variables are provided', () => {
    assert.deepEqual(
      resolvePostgresConnection({
        DATABASE_URL: 'postgres://genssl:genssl@127.0.0.1:19666/genssl',
      }),
      DEFAULT_POSTGRES_CONNECTION,
    );
  });

  it('accepts the postgresql:// scheme and percent-encoded credentials', () => {
    assert.deepEqual(
      resolvePostgresConnection({
        DATABASE_URL: 'postgresql://user%40name:p%40ss%2Fword@db.example:6543/my%2Fdb',
      }),
      {
        host: 'db.example',
        port: 6543,
        username: 'user@name',
        password: 'p@ss/word',
        database: 'my/db',
      },
    );
  });

  it('defaults the URL port to 5432 when the connection string omits it', () => {
    assert.deepEqual(
      resolvePostgresConnection({
        DATABASE_URL: 'postgres://alice:pw@db.example/app',
      }),
      {
        host: 'db.example',
        port: 5432,
        username: 'alice',
        password: 'pw',
        database: 'app',
      },
    );
  });

  it('parses IPv6 hosts from DATABASE_URL', () => {
    assert.deepEqual(
      resolvePostgresConnection({
        DATABASE_URL: 'postgres://genssl:genssl@[::1]:19666/genssl',
      }),
      {
        host: '::1',
        port: 19666,
        username: 'genssl',
        password: 'genssl',
        database: 'genssl',
      },
    );
  });

  it('lets POSTGRES_* win when DATABASE_URL is also present', () => {
    assert.deepEqual(
      resolvePostgresConnection({
        POSTGRES_HOST: '127.0.0.1',
        POSTGRES_PORT: '19666',
        POSTGRES_DB: 'genssl',
        POSTGRES_USER: 'genssl',
        POSTGRES_PASSWORD: 'from-discrete',
        DATABASE_URL: 'postgres://other:from-url@10.0.0.9:15432/otherdb',
      }),
      {
        host: '127.0.0.1',
        port: 19666,
        username: 'genssl',
        password: 'from-discrete',
        database: 'genssl',
      },
    );
  });

  it('does not keep DATABASE_URL fields when only some POSTGRES_* values are set', () => {
    assert.deepEqual(
      resolvePostgresConnection({
        POSTGRES_HOST: 'pg-host',
        DATABASE_URL: 'postgres://urluser:urlpass@url-host:15432/urldb',
      }),
      {
        host: 'pg-host',
        port: 19666,
        username: 'genssl',
        password: 'genssl',
        database: 'genssl',
      },
    );
  });

  it('rejects an invalid POSTGRES_PORT', () => {
    assert.throws(
      () => resolvePostgresConnection({ POSTGRES_PORT: 'not-a-port' }),
      /POSTGRES_PORT 不是有效的端口号/,
    );
    assert.throws(
      () => resolvePostgresConnection({ POSTGRES_PORT: '0' }),
      /POSTGRES_PORT 不是有效的端口号/,
    );
    assert.throws(
      () => resolvePostgresConnection({ POSTGRES_PORT: '70000' }),
      /POSTGRES_PORT 不是有效的端口号/,
    );
  });

  it('rejects a malformed or incomplete DATABASE_URL', () => {
    assert.throws(
      () => resolvePostgresConnection({ DATABASE_URL: 'not-a-url' }),
      /DATABASE_URL 不是有效的数据库连接串/,
    );
    assert.throws(
      () => resolvePostgresConnection({ DATABASE_URL: 'mysql://alice:pw@db.example:3306/app' }),
      /必须是 postgres:\/\/ 或 postgresql:\/\//,
    );
    assert.throws(
      () => resolvePostgresConnection({ DATABASE_URL: 'postgres:///genssl' }),
      /DATABASE_URL 缺少主机名/,
    );
    assert.throws(
      () => resolvePostgresConnection({ DATABASE_URL: 'postgres://alice:pw@db.example:15432/' }),
      /DATABASE_URL 缺少数据库名/,
    );
    assert.throws(
      () => resolvePostgresConnection({ DATABASE_URL: 'postgres://alice:pw@db.example:abc/app' }),
      /DATABASE_URL 不是有效的数据库连接串/,
    );
  });
});

describe('postgresConnectionFromConfig', () => {
  it('reads values from ConfigService without using a URL in TypeORM options', () => {
    const map: Record<string, string | undefined> = {
      POSTGRES_HOST: '127.0.0.1',
      POSTGRES_PORT: '19666',
      POSTGRES_DB: 'genssl',
      POSTGRES_USER: 'genssl',
      POSTGRES_PASSWORD: 'genssl',
      DATABASE_URL: 'postgres://ignored:ignored@example:1234/ignored',
    };
    const config = {
      get(key: string) {
        return map[key];
      },
    } as ConfigService;

    assert.deepEqual(postgresConnectionFromConfig(config), DEFAULT_POSTGRES_CONNECTION);
  });
});
