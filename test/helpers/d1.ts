// A stand-in for Cloudflare D1 (receiver/store.ts, D1Database) over node:sqlite, for the usage
// receiver's tests: the SQLite engine D1 runs on, with the receiver's tables
// (receiver/migrations/). A batch runs in one transaction, as in D1.
import { readdirSync, readFileSync } from 'node:fs';
import { DatabaseSync, type SQLInputValue } from 'node:sqlite';
import { fileURLToPath } from 'node:url';
import type { D1Database, D1PreparedStatement } from '../../receiver/store.ts';

const migrations = fileURLToPath(new URL('../../receiver/migrations/', import.meta.url));

export interface TestD1 extends D1Database {
  /** The rows a query returns, to check what the receiver keeps. */
  rows(query: string, ...values: SQLInputValue[]): Record<string, unknown>[];
  /** Runs SQL as it is, to set up a test. */
  exec(sql: string): void;
  /** Statements whose SQL matches this throw, as D1 does when a query fails. */
  fail: RegExp | null;
}

interface Statement extends D1PreparedStatement {
  run(): void;
}

export function testD1(): TestD1 {
  const sqlite = new DatabaseSync(':memory:');
  for (const file of readdirSync(migrations).sort())
    sqlite.exec(readFileSync(`${migrations}${file}`, 'utf8'));
  const db: TestD1 = {
    fail: null,
    rows: (query, ...values) => sqlite.prepare(query).all(...values) as Record<string, unknown>[],
    exec: sql => sqlite.exec(sql),
    prepare: query => statement(query, []),
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        for (const s of statements) (s as Statement).run();
        sqlite.exec('COMMIT');
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
      return statements.map(() => ({ success: true }));
    },
  };
  function statement(query: string, values: SQLInputValue[]): Statement {
    const check = () => {
      if (db.fail?.test(query)) throw new Error(`D1_ERROR: ${query}`);
    };
    return {
      bind: (...next) => statement(query, next as SQLInputValue[]),
      async first<T>() {
        check();
        return (sqlite.prepare(query).get(...values) as T | undefined) ?? null;
      },
      run() {
        check();
        sqlite.prepare(query).run(...values);
      },
    };
  }
  return db;
}
