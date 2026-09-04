export interface HealthResponse {
  status: 'ok';
  service: string;
  version: string;
  uptimeSeconds: number;
}

export function healthResponse(): HealthResponse {
  return {
    status: 'ok',
    service: 'worker',
    version: process.env['APP_VERSION'] ?? '0.0.0',
    uptimeSeconds: Math.round(process.uptime()),
  };
}
