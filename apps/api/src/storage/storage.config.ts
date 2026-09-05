/**
 * Object storage configuration.
 *
 * Profiles and uploaded files live outside Postgres: 20,014 waypoints for 96
 * dives in the seed export, and one row per sample does not scale. R2 in a
 * deployed environment, MinIO locally — both speak S3, which is why the
 * endpoint is configurable rather than assumed.
 */
export class StorageConfig {
  readonly endpoint?: string;
  readonly accessKeyId?: string;
  readonly secretAccessKey?: string;
  readonly region: string;
  readonly buckets: { uploads: string; profiles: string; exports: string };
  /** MinIO needs it; R2 and S3 do not. */
  readonly forcePathStyle: boolean;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    this.endpoint = env['S3_ENDPOINT'] || undefined;
    this.accessKeyId = env['S3_ACCESS_KEY_ID'] || undefined;
    this.secretAccessKey = env['S3_SECRET_ACCESS_KEY'] || undefined;
    // R2 ignores the region but the SDK insists on one.
    this.region = env['S3_REGION'] ?? 'auto';
    this.forcePathStyle = env['S3_FORCE_PATH_STYLE'] !== 'false';
    this.buckets = {
      uploads: env['S3_BUCKET_UPLOADS'] ?? 'mydivelog-uploads',
      profiles: env['S3_BUCKET_PROFILES'] ?? 'mydivelog-profiles',
      exports: env['S3_BUCKET_EXPORTS'] ?? 'mydivelog-exports',
    };
  }

  get configured(): boolean {
    return (
      this.endpoint !== undefined &&
      this.accessKeyId !== undefined &&
      this.secretAccessKey !== undefined
    );
  }
}
