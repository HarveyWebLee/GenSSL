import 'reflect-metadata';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { TestServerConnectionDto } from './server.dto';

function createPipe() {
  return new ValidationPipe({
    whitelist: true,
    forbidNonWhitelisted: true,
    transform: true,
  });
}

function bodyMeta() {
  return { type: 'body' as const, metatype: TestServerConnectionDto };
}

describe('TestServerConnectionDto', () => {
  it('accepts a test-connection body that also includes form fields like name and description', async () => {
    const pipe = createPipe();
    const result = (await pipe.transform(
      {
        name: 'web-01',
        description: 'edge nginx',
        host: '192.0.2.10',
        sshPort: 22,
        sshUsername: 'deploy',
        sshAuthMethod: 'password',
        sshTimeoutMs: 15000,
        sshPassword: 'placeholder-password',
        remotePath: '/etc/nginx/ssl',
      },
      bodyMeta(),
    )) as TestServerConnectionDto;

    assert.ok(result instanceof TestServerConnectionDto);
    assert.equal(result.host, '192.0.2.10');
    assert.equal(result.sshPort, 22);
    assert.equal(result.sshUsername, 'deploy');
    assert.equal(result.sshAuthMethod, 'password');
    assert.equal(result.sshTimeoutMs, 15000);
    assert.equal(result.sshPassword, 'placeholder-password');
    assert.equal(result.remotePath, '/etc/nginx/ssl');
    assert.equal(result.name, 'web-01');
    assert.equal(result.description, 'edge nginx');
  });

  it('still rejects properties that are not part of the test-connection or form management fields', async () => {
    const pipe = createPipe();
    await assert.rejects(
      () =>
        pipe.transform(
          {
            host: '192.0.2.10',
            sshUsername: 'deploy',
            unknownField: true,
          },
          bodyMeta(),
        ),
      (err: unknown) => {
        assert.ok(err instanceof BadRequestException);
        const body = err.getResponse() as { message: string | string[]; statusCode?: number };
        const messages = Array.isArray(body.message) ? body.message : [String(body.message)];
        assert.ok(messages.some((item) => item.includes('property unknownField should not exist')));
        assert.equal(body.statusCode, 400);
        return true;
      },
    );
  });
});
