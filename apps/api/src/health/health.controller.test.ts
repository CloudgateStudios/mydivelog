import { describe, expect, it } from 'vitest';
import { HealthController } from './health.controller.ts';

describe('HealthController', () => {
  it('reports ok with the service identity', () => {
    const body = new HealthController().check();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('api');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
