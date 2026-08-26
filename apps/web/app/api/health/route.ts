import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({
    status: 'ok',
    service: 'web',
    version: process.env.APP_VERSION ?? '0.0.0',
    uptimeSeconds: Math.round(process.uptime()),
  });
}
