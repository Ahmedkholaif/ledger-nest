# ledger-nest

[![ci](https://github.com/Ahmedkholaif/ledger-nest/actions/workflows/ci.yml/badge.svg)](https://github.com/Ahmedkholaif/ledger-nest/actions/workflows/ci.yml)
![NestJS](https://img.shields.io/badge/NestJS-12-E0234E?logo=nestjs&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-6-3178C6?logo=typescript&logoColor=white)
![PostgreSQL](https://img.shields.io/badge/PostgreSQL-18-4169E1?logo=postgresql&logoColor=white)

The **double-entry ledger API from [ledgerd](https://github.com/Ahmedkholaif/ledgerd), rebuilt in NestJS**. It keeps the same guarantees: atomic, balanced, idempotent transfers, deadlock-free locking and database-enforced invariants. It's written the way NestJS is meant to be used.

It is a **drop-in replacement for the Go service**: same HTTP contract, same schema, and the same idempotency fingerprint down to the byte. CI starts both services on **one database** and proves a transfer created by Go is recognised as a replay by NestJS ([`scripts/interop.sh`](scripts/interop.sh)).

## What NestJS brings

| NestJS feature | Where it's used |
|---|---|
| **Modules & dynamic modules** | `DatabaseModule.forRoot()` and `AppModule.forRoot()` take configuration, so tests boot the real app against a test database with no globals. |
| **Dependency injection** | The `LedgerService` → `DatabaseService` → `pg.Pool` chain is wired by the container. Lifecycle hooks run migrations on startup (advisory-locked) and close the pool on shutdown. |
| **DTOs + `ValidationPipe`** | `class-validator` decorators define the request contract once. Unknown fields are rejected, and errors are reshaped into ledgerd's `422 invalid_request`. |
| **OpenAPI from code** | The same DTO decorators generate a Swagger UI at **`/docs`**, so the documentation can't drift from the validation. |
| **Custom param decorator** | `@IdempotencyKey()` injects the header into the handler. |
| **Interceptor** | `IdempotentReplayInterceptor` turns `{result, replayed}` into `201` or `200` with `Idempotent-Replayed: true`. HTTP semantics stay out of the service. |
| **Global guard + metadata** | `ApiKeyGuard` requires `Bearer` auth when `API_KEY` is set. It reads `@Public()` metadata through the `Reflector`, which is how `/healthz` stays open. |
| **Exception filter** | Maps domain `LedgerError` codes to statuses and renders every error as `{"error":{"code","message"}}`. Unknown errors become an opaque, logged 500. |
| **Terminus** | `/healthz` pings the database. |
| **Testing module** | E2E tests compile the real module graph with `Test.createTestingModule`. |

## The ledger itself

- **Balanced:** postings must net to zero per currency. A deferred constraint trigger re-checks this at commit time.
- **No overdrafts:** accounts are locked with `SELECT … FOR UPDATE` in ascending id order, so there are no deadlocks.
- **Exactly once:** the idempotency key is claimed with `INSERT … ON CONFLICT DO NOTHING`, so concurrent duplicates block and then replay.
- **One round trip:** every balance update and journal entry goes in a single `unnest()` statement.
- **Append-only journal**, plus an `/v1/audit` endpoint that recomputes everything from the journal.
- **Safe numbers:** `int8` values are parsed to numbers and *rejected* if they exceed `Number.MAX_SAFE_INTEGER`, so cents are never silently lost.

## Tests

`node --test` runs against compiled output and a real PostgreSQL:

- the transfer flow, replay headers and keyset pagination
- every error code mapped to the right status
- **20 concurrent retries with one key → exactly one transfer**
- **16 concurrent clients × 25 random transfers**: no negative balances, no lost money, no deadlocks, clean audit
- the API-key guard and `@Public()` routes
- the request fingerprint matches **a test vector produced by the Go implementation**

```bash
docker compose up -d postgres
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ledger npm test
```

## Run

```bash
docker compose up --build        # API on :3000, Swagger UI on :3000/docs
```

The API is identical to [ledgerd's](https://github.com/Ahmedkholaif/ledgerd#api): `POST /v1/accounts`, `GET /v1/accounts/{id}[/entries]`, `POST /v1/transfers` (with an `Idempotency-Key` header), `GET /v1/transfers/{id}` and `GET /v1/audit`.

**Stack:** NestJS 12 (ESM), TypeScript 6, `pg`, Node's built-in test runner and supertest. There's no ORM: the interesting parts (locking order, `ON CONFLICT`, deferred constraints) are SQL, and they stay visible.
