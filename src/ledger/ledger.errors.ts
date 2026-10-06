export type LedgerErrorCode = 'invalid_request' | 'not_found' | 'insufficient_funds' | 'idempotency_conflict';

/** Domain error. The exception filter maps each code to the HTTP status ledgerd uses. */
export class LedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
  }

  static invalid(message: string) {
    return new LedgerError('invalid_request', `invalid request: ${message}`);
  }
  static notFound(what = 'not found') {
    return new LedgerError('not_found', what);
  }
}
