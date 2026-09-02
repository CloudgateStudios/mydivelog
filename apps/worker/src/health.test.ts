import { describe, expect, it } from 'vitest';
import { healthResponse } from './health.ts';

describe('healthResponse', () => {
  it('identifies the worker service', () => {
    const body = healthResponse();
    expect(body.status).toBe('ok');
    expect(body.service).toBe('worker');
    expect(body.uptimeSeconds).toBeGreaterThanOrEqual(0);
  });
});
