import 'reflect-metadata';
import assert from 'node:assert/strict';
import { after, before, beforeEach, describe, test } from 'node:test';
import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import { AppModule, configureApp } from './app.module.js';
import { DatabaseService } from './database/database.service.js';

const DATABASE_URL = process.env.TEST_DATABASE_URL;
const skip = DATABASE_URL ? false : 'TEST_DATABASE_URL not set';

async function boot(apiKey?: string) {
  const mod = await Test.createTestingModule({ imports: [AppModule.forRoot({ databaseUrl: DATABASE_URL!, apiKey })] }).compile();
  const app = configureApp(mod.createNestApplication({ logger: false }));
  await app.init();
  return app;
}

describe('ledger-nest e2e', { skip }, () => {
  let app: INestApplication;
  let http: ReturnType<typeof request>; // over a real socket, like a client

  before(async () => {
    app = await boot();
    await app.listen(0, '127.0.0.1');
    http = request(await app.getUrl());
  });
  after(() => app?.close());
  beforeEach(() => app.get(DatabaseService).query('TRUNCATE entries, transfers, accounts'));

  const account = async (name: string, currency = 'USD', allow_negative = false) =>
    (await http.post('/v1/accounts').send({ name, currency, allow_negative }).expect(201)).body.id as string;
  const move = (key: string, from: string, to: string, amount: number) =>
    http.post('/v1/transfers').set('Idempotency-Key', key).send({ postings: [{ account_id: from, amount: -amount }, { account_id: to, amount }] });
  const balance = async (id: string) => (await http.get(`/v1/accounts/${id}`).expect(200)).body.balance as number;
  const assertConsistent = async () => assert.deepEqual((await http.get('/v1/audit').expect(200)).body, { consistent: true, mismatches: [] });

  test('moves money and replays idempotent retries', async () => {
    const world = await account('world', 'USD', true);
    const alice = await account('alice');
    const first = await move('topup-1', world, alice, 2500).expect(201);
    const again = await move('topup-1', world, alice, 2500).expect(200);
    assert.equal(again.headers['idempotent-replayed'], 'true');
    assert.equal(again.body.id, first.body.id);
    assert.equal(await balance(alice), 2500);

    const list = await http.get('/v1/accounts').expect(200);
    assert.deepEqual(list.body.accounts.map((a: { name: string }) => a.name), ['world', 'alice']);

    const page = await http.get(`/v1/accounts/${alice}/entries?limit=1`).expect(200);
    assert.equal(page.body.entries[0].balance_after, 2500);
    assert.equal(page.body.next_after, page.body.entries[0].id);
    await assertConsistent();
  });

  test('maps domain errors to ledgerd status codes', async () => {
    const world = await account('world', 'USD', true);
    const alice = await account('alice');
    const eur = await account('eur', 'EUR', true);
    await move('k', world, alice, 100).expect(201);

    const conflict = await move('k', world, alice, 999).expect(409);
    assert.equal(conflict.body.error.code, 'idempotency_conflict');
    assert.equal((await move('overdraw', alice, world, 101).expect(409)).body.error.code, 'insufficient_funds');
    assert.equal((await move('fx', alice, eur, 50).expect(422)).body.error.code, 'invalid_request');
    assert.equal((await http.post('/v1/transfers').send({ postings: [] }).expect(422)).body.error.code, 'invalid_request');
    await http.post('/v1/accounts').send({ name: 'x', currency: 'usd' }).expect(422);
    await http.post('/v1/accounts').send({ name: 'x', currency: 'USD', extra: 1 }).expect(422);
    await http.get('/v1/accounts/not-a-uuid').expect(404);
    await assertConsistent();
  });

  test('a burst of retries with one key creates exactly one transfer', async () => {
    const world = await account('world', 'USD', true);
    const alice = await account('alice');
    const results = await Promise.all(Array.from({ length: 20 }, () => move('race', world, alice, 50)));
    const created = results.filter((r) => r.status === 201);
    assert.equal(created.length, 1);
    assert.ok(results.every((r) => r.body.id === created[0].body.id));
    assert.equal(await balance(alice), 50);
  });

  test('concurrent random transfers never overdraw, deadlock or leak money', async () => {
    const world = await account('world', 'USD', true);
    const ids = await Promise.all(Array.from({ length: 6 }, (_, i) => account(`acct-${i}`)));
    for (const id of ids) await move(`fund-${id}`, world, id, 1_000).expect(201);

    let applied = 0;
    let rejected = 0;
    let seed = 42;
    const rnd = (n: number) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
    await Promise.all(
      Array.from({ length: 16 }, async (_, w) => {
        for (let i = 0; i < 25; i++) {
          const from = rnd(ids.length);
          const to = (from + 1 + rnd(ids.length - 1)) % ids.length;
          const r = await move(`w${w}-${i}`, ids[from], ids[to], 1 + rnd(400));
          if (r.status === 201) applied++;
          else if (r.body.error?.code === 'insufficient_funds') rejected++;
          else assert.fail(`unexpected ${r.status} ${JSON.stringify(r.body)}`);
        }
      }),
    );
    const balances = await Promise.all(ids.map(balance));
    assert.ok(balances.every((b) => b >= 0), `negative balance in ${balances}`);
    assert.equal(balances.reduce((a, b) => a + b, 0), ids.length * 1_000);
    assert.ok(applied > 0 && applied + rejected === 400);
    await assertConsistent();
  });
});

describe('API key guard', { skip }, () => {
  test('protects routes except @Public() ones', async () => {
    const app = await boot('s3cret');
    const http = request(app.getHttpServer());
    try {
      await http.get('/healthz').expect(200);
      assert.equal((await http.get('/v1/audit').expect(401)).body.error.code, 'unauthorized');
      await http.get('/v1/audit').set('Authorization', 'Bearer wrong').expect(401);
      await http.get('/v1/audit').set('Authorization', 'Bearer s3cret').expect(200);
    } finally {
      await app.close();
    }
  });
});
