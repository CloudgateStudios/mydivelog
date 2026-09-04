import { Injectable, type NestMiddleware } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';

/**
 * One id per request, echoed in the response and carried into logs so an API
 * error can be traced through to the worker that eventually handles the job.
 */
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.header('x-request-id');
    // Do not trust an arbitrary client value into logs unbounded.
    const id = incoming && incoming.length <= 128 ? incoming : randomUUID();
    res.setHeader('x-request-id', id);
    (req as Request & { requestId?: string }).requestId = id;
    next();
  }
}
