import { createHash } from 'node:crypto';

export interface Posting {
  account_id: string;
  amount: number;
}

/**
 * Fingerprints a transfer request, independent of posting order.
 *
 * This is byte-for-byte the same as ledgerd's Go implementation (json.Marshal
 * of {D, P} with Go's HTML-safe escaping), so a retry is recognised as the
 * same request no matter which backend handled the original.
 */
export function requestHash(description: string, postings: Posting[]): Buffer {
  const sorted = [...postings]
    .sort((a, b) => (a.account_id < b.account_id ? -1 : a.account_id > b.account_id ? 1 : 0))
    .map((p) => ({ account_id: p.account_id, amount: p.amount }));
  return createHash('sha256').update(goJSON({ D: description, P: sorted })).digest();
}

// encoding/json escapes <, >, & and the JS line separators; JSON.stringify doesn't.
function goJSON(v: unknown): string {
  return JSON.stringify(v).replace(/[<>&\u2028\u2029]/g, (c) => '\\u' + c.charCodeAt(0).toString(16).padStart(4, '0'));
}
