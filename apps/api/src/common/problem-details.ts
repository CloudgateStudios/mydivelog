import {
  type ArgumentsHost,
  Catch,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { ZodError } from 'zod';

/**
 * RFC 9457 Problem Details for every error.
 *
 * `type` and `errors[].code` are machine-readable on purpose: the Flutter app
 * has to render a useful message offline without parsing English prose.
 */

const BASE = 'https://mydivelog.app/errors';

export class ProblemException extends HttpException {
  constructor(
    status: number,
    readonly problemType: string,
    title: string,
    detail?: string,
    readonly errors?: { field?: string; code: string; message?: string }[],
  ) {
    super({ title, detail }, status);
  }
}

export const notFound = (what = 'Resource') =>
  new ProblemException(HttpStatus.NOT_FOUND, `${BASE}/not-found`, `${what} not found`);

export const unauthorized = (detail?: string) =>
  new ProblemException(
    HttpStatus.UNAUTHORIZED,
    `${BASE}/unauthorized`,
    'Not authenticated',
    detail,
  );

export const badRequest = (detail: string, code = 'bad_request') =>
  new ProblemException(HttpStatus.BAD_REQUEST, `${BASE}/bad-request`, 'Bad request', detail, [
    { code },
  ]);

export const conflict = (detail: string, code = 'conflict') =>
  new ProblemException(HttpStatus.CONFLICT, `${BASE}/conflict`, 'Conflict', detail, [{ code }]);

export const tooManyRequests = (detail: string) =>
  new ProblemException(
    HttpStatus.TOO_MANY_REQUESTS,
    `${BASE}/rate-limited`,
    'Too many requests',
    detail,
  );

@Catch()
export class ProblemDetailsFilter implements ExceptionFilter {
  private readonly logger = new Logger('http');

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const problem = this.toProblem(exception, req.originalUrl);

    if (problem.status >= 500) {
      // Log the cause, return none of it: an internal message can carry
      // connection strings and query fragments.
      this.logger.error(
        { requestId: res.getHeader('x-request-id'), path: req.originalUrl, err: exception },
        'unhandled error',
      );
    }

    res.status(problem.status).type('application/problem+json').json(problem);
  }

  private toProblem(exception: unknown, instance: string) {
    if (exception instanceof ZodError) {
      return {
        type: `${BASE}/validation-failed`,
        title: 'Validation failed',
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        instance,
        errors: exception.issues.map((i) => ({
          field: i.path.join('.') || undefined,
          code: i.code,
          message: i.message,
        })),
      };
    }

    if (exception instanceof ProblemException) {
      const body = exception.getResponse() as { title: string; detail?: string };
      return {
        type: exception.problemType,
        title: body.title,
        status: exception.getStatus(),
        detail: body.detail,
        instance,
        errors: exception.errors,
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const raw = exception.getResponse();
      const detail =
        typeof raw === 'string' ? raw : ((raw as { message?: string }).message ?? undefined);
      return { type: `${BASE}/http-${status}`, title: exception.name, status, detail, instance };
    }

    return {
      type: `${BASE}/internal`,
      title: 'Internal server error',
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      instance,
    };
  }
}
