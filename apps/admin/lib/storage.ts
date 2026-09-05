import { GetObjectCommand, S3Client } from '@aws-sdk/client-s3';

/**
 * Reads profile blobs so the panel can draw them.
 *
 * Profiles live outside Postgres — 20,014 waypoints for 96 dives in the seed
 * export — so the only way to confirm one decoded correctly is to fetch it and
 * look. Read-only, and only the profiles bucket.
 *
 * Unconfigured is a normal state, not an error: a local checkout without MinIO
 * running still shows every other page. The chart says the profile is stored
 * elsewhere rather than the page failing.
 */

const endpoint = process.env['S3_ENDPOINT'];
const accessKeyId = process.env['S3_ACCESS_KEY_ID'];
const secretAccessKey = process.env['S3_SECRET_ACCESS_KEY'];
const bucket = process.env['S3_BUCKET_PROFILES'] ?? 'mydivelog-profiles';

export const storageConfigured = Boolean(endpoint && accessKeyId && secretAccessKey);

let client: S3Client | undefined;

export async function readProfileBlob(key: string): Promise<Uint8Array | undefined> {
  if (!storageConfigured) return undefined;
  client ??= new S3Client({
    region: process.env['S3_REGION'] ?? 'auto',
    endpoint,
    forcePathStyle: process.env['S3_FORCE_PATH_STYLE'] !== 'false',
    credentials: { accessKeyId: accessKeyId as string, secretAccessKey: secretAccessKey as string },
  });

  try {
    const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return await res.Body?.transformToByteArray();
  } catch {
    // A missing blob is a finding, not a crash. The page says so and the rest
    // of the dive still renders.
    return undefined;
  }
}
