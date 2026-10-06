import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestHash } from './request-hash.js';

// Vector produced by ledgerd's Go requestHash for the same input.
test('request hash matches the Go implementation byte for byte', () => {
  const h = requestHash('Top-up <b>&amp; \u2028 "ü"', [
    { account_id: 'bbbbbbbb-0000-0000-0000-000000000002', amount: 2500 },
    { account_id: 'aaaaaaaa-0000-0000-0000-000000000001', amount: -2500 },
  ]);
  assert.equal(h.toString('hex'), '6fd96f553e8b1ec388b3f39fb9a475c6325ea1fce65635b639cec53d1c376934');
});

test('posting order does not change the hash', () => {
  const a = { account_id: 'a', amount: -1 };
  const b = { account_id: 'b', amount: 1 };
  assert.deepEqual(requestHash('x', [a, b]), requestHash('x', [b, a]));
  assert.notDeepEqual(requestHash('x', [a, b]), requestHash('y', [a, b]));
});
