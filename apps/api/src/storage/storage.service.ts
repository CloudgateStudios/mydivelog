import { createHash } from 'node:crypto';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { Injectable, Logger } from '@nestjs/common';
import { StorageConfig } from './storage.config.ts';

export type StoredObject = {
  key: string;
  byteSize: number;
  checksum: string;
};

/**
 * Reads and writes the blobs that do not belong in Postgres.
 *
 * Keys are scoped by user id. An object key is not an authorization check —
 * every read here is reached through a repository that has already scoped the
 * row — but keeping the owner in the path means a leaked key cannot be
 * incremented into someone else's data, and it makes a bucket listing legible
 * during an incident.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private client?: S3Client;

  constructor(private readonly config: StorageConfig) {}

  get configured(): boolean {
    return this.config.configured;
  }

  private s3(): S3Client {
    if (!this.config.configured) {
      throw new Error(
        'Object storage is not configured: set S3_ENDPOINT, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY.',
      );
    }
    this.client ??= new S3Client({
      region: this.config.region,
      endpoint: this.config.endpoint as string,
      forcePathStyle: this.config.forcePathStyle,
      credentials: {
        accessKeyId: this.config.accessKeyId as string,
        secretAccessKey: this.config.secretAccessKey as string,
      },
    });
    return this.client;
  }

  uploadKey(userId: string, batchId: string, fileName: string): string {
    // The original name is not used in the key. It is attacker-controlled on
    // an upload endpoint, and a key is a path.
    return `${userId}/${batchId}/${sha256(fileName).slice(0, 16)}`;
  }

  profileKey(userId: string, diveId: string): string {
    return `${userId}/${diveId}.mdlp`;
  }

  async putUpload(key: string, body: Uint8Array, contentType: string): Promise<StoredObject> {
    return this.put(this.config.buckets.uploads, key, body, contentType);
  }

  async putProfile(key: string, body: Uint8Array): Promise<StoredObject> {
    return this.put(this.config.buckets.profiles, key, body, 'application/octet-stream');
  }

  async getUpload(key: string): Promise<Uint8Array> {
    return this.get(this.config.buckets.uploads, key);
  }

  async getProfile(key: string): Promise<Uint8Array> {
    return this.get(this.config.buckets.profiles, key);
  }

  private async put(
    bucket: string,
    key: string,
    body: Uint8Array,
    contentType: string,
  ): Promise<StoredObject> {
    await this.s3().send(
      new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }),
    );
    return { key, byteSize: body.byteLength, checksum: sha256(body) };
  }

  private async get(bucket: string, key: string): Promise<Uint8Array> {
    const res = await this.s3().send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!res.Body) throw new Error(`Object ${bucket}/${key} has no body.`);
    return res.Body.transformToByteArray();
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash('sha256').update(value).digest('hex');
}
