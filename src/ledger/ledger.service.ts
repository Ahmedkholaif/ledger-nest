import { Injectable } from '@nestjs/common';
import type { QueryResult } from 'pg';
import { DatabaseService } from '../database/database.service.js';
import type { AccountDto, AuditDto, CreateAccountDto, CreateTransferDto, EntryDto, TransferDto } from './dto/ledger.dto.js';
import { LedgerError } from './ledger.errors.js';
import { requestHash } from './request-hash.js';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACCOUNT_COLS = 'id::text, name, currency, allow_negative, balance, created_at';
const ENTRY_COLS = 'id, transfer_id::text, account_id::text, amount, currency, balance_after, created_at';

/** Anything that can run a query: the pool wrapper or a transaction's client. */
type Queryable = { query(sql: string, params?: unknown[]): Promise<QueryResult> };

export interface TransferResult {
  transfer: TransferDto;
  replayed: boolean;
}

/**
 * The ledger's domain logic. It mirrors ledgerd (Go): same SQL, same locking
 * order, same idempotency rules. The database enforces the core invariants
 * too, so the two services can safely share one database.
 */
@Injectable()
export class LedgerService {
  constructor(private readonly db: DatabaseService) {}

  async createAccount(dto: CreateAccountDto): Promise<AccountDto> {
    const { rows } = await this.db.query<AccountDto>(
      `INSERT INTO accounts (name, currency, allow_negative) VALUES ($1, $2, $3) RETURNING ${ACCOUNT_COLS}`,
      [dto.name, dto.currency, dto.allow_negative ?? false],
    );
    return rows[0];
  }

  async listAccounts(limit = 100): Promise<AccountDto[]> {
    if (!(limit > 0 && limit <= 500)) limit = 100;
    const { rows } = await this.db.query<AccountDto>(`SELECT ${ACCOUNT_COLS} FROM accounts ORDER BY created_at, id LIMIT $1`, [limit]);
    return rows;
  }

  async getAccount(id: string): Promise<AccountDto> {
    if (!UUID.test(id)) throw LedgerError.notFound();
    const { rows } = await this.db.query<AccountDto>(`SELECT ${ACCOUNT_COLS} FROM accounts WHERE id = $1`, [id]);
    if (!rows[0]) throw LedgerError.notFound();
    return rows[0];
  }

  async listEntries(accountId: string, after = 0, limit = 100): Promise<EntryDto[]> {
    await this.getAccount(accountId);
    if (!(limit > 0 && limit <= 500)) limit = 100;
    const { rows } = await this.db.query<EntryDto>(
      `SELECT ${ENTRY_COLS} FROM entries WHERE account_id = $1 AND id > $2 ORDER BY id LIMIT $3`,
      [accountId, after, limit],
    );
    return rows;
  }

  async getTransfer(id: string): Promise<TransferDto> {
    if (!UUID.test(id)) throw LedgerError.notFound();
    return this.loadTransfer(this.db, 'id = $1', id);
  }

  /**
   * Applies a balanced set of postings atomically. A retry with the same key
   * and body replays the original result; the same key with a different body
   * is a conflict. A rejected transfer does not consume its key.
   */
  async transfer(idempotencyKey: string | undefined, dto: CreateTransferDto): Promise<TransferResult> {
    if (!idempotencyKey || idempotencyKey.length > 255) {
      throw LedgerError.invalid('an idempotency key of 1-255 characters is required');
    }
    const description = dto.description ?? '';
    const seen = new Set<string>();
    for (const p of dto.postings) {
      const id = p.account_id.toLowerCase();
      if (seen.has(id)) throw LedgerError.invalid(`account ${p.account_id} appears more than once`);
      seen.add(id);
    }
    const hash = requestHash(description, dto.postings);

    const result = await this.db.transaction(async (tx) => {
      // Claim the key. A concurrent holder of the same key makes this block on
      // the unique index until that transaction commits or rolls back.
      const claimed = await tx.query<{ id: string }>(
        `INSERT INTO transfers (idempotency_key, request_hash, description) VALUES ($1, $2, $3)
         ON CONFLICT (idempotency_key) DO NOTHING RETURNING id::text`,
        [idempotencyKey, hash, description],
      );
      if (claimed.rowCount === 0) return null; // replay, handled after this transaction
      const transferId = claimed.rows[0].id;

      // Lock touched accounts in ascending id order, so overlapping transfers
      // always take their locks in the same order and can never deadlock.
      const ids = [...seen].sort();
      const { rows: accounts } = await tx.query<{ id: string; currency: string; allow_negative: boolean; balance: number }>(
        `SELECT id::text, currency, allow_negative, balance FROM accounts WHERE id = ANY($1::uuid[]) ORDER BY id FOR UPDATE`,
        [ids],
      );
      const byId = new Map(accounts.map((a) => [a.id, a]));
      for (const id of ids) {
        if (!byId.has(id)) throw LedgerError.notFound(`not found: account ${id}`);
      }

      const net = new Map<string, number>();
      for (const p of dto.postings) {
        const cur = byId.get(p.account_id.toLowerCase())!.currency;
        net.set(cur, (net.get(cur) ?? 0) + p.amount);
      }
      for (const [cur, sum] of net) {
        if (sum !== 0) throw LedgerError.invalid(`postings must net to zero per currency; ${cur} nets to ${sum}`);
      }

      for (const p of dto.postings) {
        const a = byId.get(p.account_id.toLowerCase())!;
        const next = a.balance + p.amount;
        if (!Number.isSafeInteger(next)) throw LedgerError.invalid(`balance overflow on account ${p.account_id}`);
        if (next < 0 && !a.allow_negative) {
          throw new LedgerError('insufficient_funds', `insufficient funds: account ${p.account_id} has ${a.balance}, needs ${-p.amount}`);
        }
        a.balance = next;
      }

      // One round trip for every balance update and journal entry.
      const postings = dto.postings.map((p) => {
        const a = byId.get(p.account_id.toLowerCase())!;
        return { id: a.id, amount: p.amount, currency: a.currency, balance: a.balance };
      });
      await tx.query(
        `WITH p AS (
           SELECT * FROM unnest($2::uuid[], $3::bigint[], $4::text[], $5::bigint[]) AS t(account_id, amount, currency, balance_after)
         ), upd AS (
           UPDATE accounts a SET balance = p.balance_after FROM p WHERE a.id = p.account_id
         )
         INSERT INTO entries (transfer_id, account_id, amount, currency, balance_after)
         SELECT $1, account_id, amount, currency, balance_after FROM p`,
        [transferId, postings.map((p) => p.id), postings.map((p) => p.amount), postings.map((p) => p.currency), postings.map((p) => p.balance)],
      );
      return this.loadTransfer(tx, 'id = $1', transferId);
    });

    if (result) return { transfer: result, replayed: false };
    return this.replay(idempotencyKey, hash);
  }

  async audit(): Promise<AuditDto> {
    const { rows } = await this.db.query(
      `SELECT 'account' AS kind, a.id::text AS id, COALESCE(sum(e.amount), 0)::bigint AS expected, a.balance AS actual
       FROM accounts a LEFT JOIN entries e ON e.account_id = a.id
       GROUP BY a.id HAVING a.balance <> COALESCE(sum(e.amount), 0)
       UNION ALL
       SELECT 'currency', currency, 0::bigint, sum(balance)::bigint
       FROM accounts GROUP BY currency HAVING sum(balance) <> 0`,
    );
    return { consistent: rows.length === 0, mismatches: rows };
  }

  private async replay(key: string, hash: Buffer): Promise<TransferResult> {
    const { rows } = await this.db.query<{ request_hash: Buffer }>('SELECT request_hash FROM transfers WHERE idempotency_key = $1', [key]);
    if (!rows[0]?.request_hash.equals(hash)) {
      throw new LedgerError('idempotency_conflict', 'idempotency key reused with a different request');
    }
    return { transfer: await this.loadTransfer(this.db, 'idempotency_key = $1', key), replayed: true };
  }

  private async loadTransfer(q: Queryable, where: string, arg: string): Promise<TransferDto> {
    const t = await q.query(`SELECT id::text, idempotency_key, description, created_at FROM transfers WHERE ${where}`, [arg]);
    if (!t.rows[0]) throw LedgerError.notFound();
    const e = await q.query(`SELECT ${ENTRY_COLS} FROM entries WHERE transfer_id = $1 ORDER BY id`, [t.rows[0].id]);
    return { ...t.rows[0], entries: e.rows };
  }
}
