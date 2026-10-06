import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { Response } from 'express';
import { LedgerError, LedgerErrorCode } from '../ledger/ledger.errors.js';

const STATUS: Record<LedgerErrorCode, number> = {
  invalid_request: HttpStatus.UNPROCESSABLE_ENTITY,
  not_found: HttpStatus.NOT_FOUND,
  insufficient_funds: HttpStatus.CONFLICT,
  idempotency_conflict: HttpStatus.CONFLICT,
};

/**
 * Renders every error in ledgerd's shape: {"error":{"code","message"}}.
 * Domain errors map to their status; unexpected errors become an opaque 500
 * and are logged.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  private readonly log = new Logger('ErrorFilter');

  catch(err: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'internal';
    let message = 'internal error';

    if (err instanceof LedgerError) {
      status = STATUS[err.code];
      code = err.code;
      message = err.message;
    } else if (err instanceof HttpException) {
      status = err.getStatus();
      code = status === HttpStatus.NOT_FOUND ? 'not_found' : status === HttpStatus.UNAUTHORIZED ? 'unauthorized' : 'bad_request';
      message = err.message;
    } else {
      this.log.error(err instanceof Error ? (err.stack ?? err.message) : String(err));
    }
    res.status(status).json({ error: { code, message } });
  }
}
