import { CallHandler, createParamDecorator, ExecutionContext, HttpStatus, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request, Response } from 'express';
import { map, Observable } from 'rxjs';

/** Injects the Idempotency-Key request header into a handler parameter. */
export const IdempotencyKey = createParamDecorator((_: unknown, ctx: ExecutionContext) =>
  ctx.switchToHttp().getRequest<Request>().header('Idempotency-Key'),
);

/**
 * Handlers return { result, replayed }. The interceptor turns a replay into
 * 200 + "Idempotent-Replayed: true" (a first execution keeps 201), keeping
 * HTTP concerns out of the service and the controller.
 */
@Injectable()
export class IdempotentReplayInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      map((out: { result: unknown; replayed: boolean }) => {
        if (out.replayed) {
          const res = ctx.switchToHttp().getResponse<Response>();
          res.status(HttpStatus.OK).setHeader('Idempotent-Replayed', 'true');
        }
        return out.result;
      }),
    );
  }
}
