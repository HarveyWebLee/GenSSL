import { Readable } from 'node:stream';
import { ServiceUnavailableException } from '@nestjs/common';
import { assertSafeObjectKey } from '../storage/upload-guard';
import type { RustfsService, StoredObject } from '../storage/rustfs.service';

export class MemoryRustfsService {
  objects = new Map<string, Buffer>();
  ready = true;
  lastError: string | null = null;
  endpoint = 'http://127.0.0.1:19701';
  bucket = 'genssl';

  getStatus() {
    return {
      ready: this.ready,
      endpoint: this.endpoint,
      bucket: this.bucket,
      lastError: this.lastError,
    };
  }

  assertReady(): void {
    if (!this.ready) {
      throw new ServiceUnavailableException(
        `文件服务器（RustFS）暂不可用：${this.lastError ?? '未连接'}。`,
      );
    }
  }

  async putObject(objectKey: string, body: Buffer | string, _contentType?: string): Promise<StoredObject> {
    this.assertReady();
    const key = assertSafeObjectKey(objectKey);
    const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    this.objects.set(key, payload);
    return { key, size: payload.length };
  }

  async objectExists(objectKey: string): Promise<boolean> {
    this.assertReady();
    return this.objects.has(assertSafeObjectKey(objectKey));
  }

  async listPrefix(prefix: string): Promise<StoredObject[]> {
    this.assertReady();
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const items: StoredObject[] = [];
    for (const [key, body] of this.objects) {
      if (key.startsWith(normalized) || key === prefix) {
        items.push({ key, size: body.length });
      }
    }
    return items;
  }

  async getObjectStream(objectKey: string): Promise<{
    stream: Readable;
    contentType?: string;
    contentLength?: number;
    key: string;
  }> {
    this.assertReady();
    const key = assertSafeObjectKey(objectKey);
    const body = this.objects.get(key);
    if (!body) {
      throw new ServiceUnavailableException('文件服务器中不存在该对象。');
    }
    return {
      stream: Readable.from(body),
      contentType: 'application/octet-stream',
      contentLength: body.length,
      key,
    };
  }

  async getObjectBuffer(objectKey: string): Promise<{ buffer: Buffer; contentType?: string; key: string }> {
    this.assertReady();
    const key = objectKey;
    const body = this.objects.get(key);
    if (!body) {
      throw new Error('missing');
    }
    return { buffer: body, key, contentType: 'application/octet-stream' };
  }

  async getObjectText(objectKey: string): Promise<string> {
    this.assertReady();
    const key = assertSafeObjectKey(objectKey);
    const body = this.objects.get(key);
    if (!body) {
      throw new ServiceUnavailableException('文件服务器中不存在该对象。');
    }
    return body.toString('utf8');
  }
}

export type { RustfsService };
