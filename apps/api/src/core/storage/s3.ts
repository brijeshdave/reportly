// Author: Brijesh Dave <https://github.com/brijeshdave>
// The S3-compatible backend — AWS S3, MinIO, Cloudflare R2, Backblaze B2. The AWS
// SDK talks to all of them; an endpoint plus path-style addressing is what makes the
// non-AWS ones work, which is why both are env vars rather than assumptions.
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type { StorageProvider } from "@/core/storage/provider.js";
import type { StorageBackend } from "@reportly/shared";

export interface S3Options {
  bucket: string;
  region: string;
  endpoint?: string | undefined;
  accessKeyId?: string | undefined;
  secretAccessKey?: string | undefined;
  forcePathStyle?: boolean;
}

export class S3Storage implements StorageProvider {
  readonly name: StorageBackend = "s3";
  private readonly client: S3Client;

  constructor(private readonly options: S3Options) {
    this.client = new S3Client({
      region: options.region,
      ...(options.endpoint ? { endpoint: options.endpoint } : {}),
      forcePathStyle: options.forcePathStyle ?? false,
      // Omitting the credentials entirely lets the SDK use the ambient chain (an
      // instance role, a mounted web identity token) — the right way to run on AWS,
      // and the reason these are optional rather than required.
      ...(options.accessKeyId && options.secretAccessKey
        ? {
            credentials: {
              accessKeyId: options.accessKeyId,
              secretAccessKey: options.secretAccessKey,
            },
          }
        : {}),
    });
  }

  async put(key: string, body: Buffer, contentType: string): Promise<void> {
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.options.bucket,
        Key: key,
        Body: body,
        ContentType: contentType,
      }),
    );
  }

  async get(key: string): Promise<Buffer> {
    const result = await this.client.send(
      new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
    );
    if (!result.Body) throw new Error(`S3 returned no body for ${key}`);
    return Buffer.from(await result.Body.transformToByteArray());
  }

  async delete(key: string): Promise<void> {
    // S3 treats deleting a missing key as success, which is the contract we want.
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
      return true;
    } catch {
      return false;
    }
  }
}
