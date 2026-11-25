import {
  Injectable,
  Logger,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  CreateBucketCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
  type _Object,
} from '@aws-sdk/client-s3';
import { Readable } from 'node:stream';
import { assertSafeObjectKey } from './upload-guard';

export interface StoredObject {
  key: string;
  size: number;
  lastModified?: string;
}

@Injectable()
export class RustfsService implements OnModuleInit {
  private readonly logger = new Logger(RustfsService.name);
  private readonly client: S3Client;
  private readonly bucket: string;
  private readonly endpoint: string;
  private ready = false;
  private lastError: string | null = null;

  constructor(private readonly config: ConfigService) {
    this.endpoint = this.config.get<string>('RUSTFS_ENDPOINT')?.trim() || 'http://127.0.0.1:19701';
    this.bucket = this.config.get<string>('RUSTFS_BUCKET')?.trim() || 'genssl';
    const accessKeyId =
      this.config.get<string>('RUSTFS_ACCESS_KEY')?.trim() || 'rustfsadmin';
    const secretAccessKey =
      this.config.get<string>('RUSTFS_SECRET_KEY')?.trim() || 'rustfsadmin';
    const region = this.config.get<string>('RUSTFS_REGION')?.trim() || 'us-east-1';

    this.client = new S3Client({
      endpoint: this.endpoint,
      region,
      credentials: { accessKeyId, secretAccessKey },
      forcePathStyle: true,
    });
  }

  async onModuleInit(): Promise<void> {
    try {
      await this.ensureBucket();
      this.ready = true;
      this.lastError = null;
      this.logger.log(`RustFS 已就绪：${this.endpoint}  bucket=${this.bucket}`);
    } catch (error) {
      this.ready = false;
      this.lastError = error instanceof Error ? error.message : '未知错误';
      this.logger.warn(
        `暂无法连接 RustFS（${this.endpoint}）：${this.lastError}。签发与根 CA 仍可使用；上传前请先执行 docker compose up -d。`,
      );
    }
  }

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
        `文件服务器（RustFS）暂不可用：${this.lastError ?? '未连接'}。请先在项目根目录执行 docker compose up -d，并确认 http://127.0.0.1:19701 可访问。`,
      );
    }
  }

  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this.ready = true;
      return;
    } catch {
      // create if missing
    }
    await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
    this.ready = true;
  }

  async putObject(objectKey: string, body: Buffer | string, contentType?: string): Promise<StoredObject> {
    this.assertReady();
    const key = assertSafeObjectKey(objectKey);
    const payload = typeof body === 'string' ? Buffer.from(body, 'utf8') : body;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: payload,
        ContentType: contentType || 'application/octet-stream',
      }),
    );
    return { key, size: payload.length };
  }

  async objectExists(objectKey: string): Promise<boolean> {
    this.assertReady();
    const key = assertSafeObjectKey(objectKey);
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }

  async listPrefix(prefix: string): Promise<StoredObject[]> {
    this.assertReady();
    const normalized = prefix.endsWith('/') ? prefix : `${prefix}/`;
    const items: StoredObject[] = [];
    let token: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: normalized,
          ContinuationToken: token,
        }),
      );
      for (const object of response.Contents ?? []) {
        this.collectObject(object, items);
      }
      token = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (token);
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
    const response = await this.client.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
    );
    if (!response.Body) {
      throw new ServiceUnavailableException('文件服务器返回了空对象。');
    }
    return {
      stream: response.Body as Readable,
      contentType: response.ContentType,
      contentLength: response.ContentLength,
      key,
    };
  }

  private collectObject(object: _Object, items: StoredObject[]): void {
    if (!object.Key) {
      return;
    }
    try {
      assertSafeObjectKey(object.Key);
    } catch {
      this.logger.warn(`跳过非法对象键：${object.Key}`);
      return;
    }
    items.push({
      key: object.Key,
      size: object.Size ?? 0,
      lastModified: object.LastModified?.toISOString(),
    });
  }
}
