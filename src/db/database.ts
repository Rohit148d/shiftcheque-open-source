/**
 * SQLite access layer (spec 89/101).
 *
 * - `openAppDatabase()` runs pending migrations exactly once.
 * - Prepared statements are used everywhere user input is bound.
 * - A tiny generic repository interface keeps SQL out of the UI.
 *
 * The database file lives in the app's private storage. It can be promoted to
 * SQLCipher by enabling the expo-sqlite `useSQLCipher` config plugin and
 * supplying a key from expo-secure-store — see docs/PRIVACY_DATA_MAP.md.
 */
import * as SQLite from 'expo-sqlite';

import { BRAND } from '../config/brand.ts';
import { MIGRATIONS, SCHEMA_VERSION } from './schema.ts';

export type SqlRow = Record<string, string | number | null>;

let database: SQLite.SQLiteDatabase | null = null;
let migrationPromise: Promise<SQLite.SQLiteDatabase> | null = null;

/** Brand-derived so a rename also renames the database file. */
export const DATABASE_NAME = `${BRAND.SHORT_NAME.toLowerCase()}.db`;

export async function openAppDatabase(): Promise<SQLite.SQLiteDatabase> {
  if (database) return database;
  if (migrationPromise) return migrationPromise;
  migrationPromise = (async () => {
    const db = await SQLite.openDatabaseAsync(DATABASE_NAME);
    await db.execAsync('PRAGMA journal_mode = WAL;');
    await db.execAsync('PRAGMA foreign_keys = ON;');
    await migrate(db);
    database = db;
    return db;
  })();
  return migrationPromise;
}

export async function migrate(db: SQLite.SQLiteDatabase): Promise<number> {
  const result = await db.getFirstAsync<{ user_version: number }>('PRAGMA user_version');
  let version = result?.user_version ?? 0;
  while (version < SCHEMA_VERSION) {
    const sql = MIGRATIONS[version];
    if (!sql) break;
    await db.withExclusiveTransactionAsync(async (txn) => {
      await txn.execAsync(sql);
    });
    version += 1;
    await db.execAsync(`PRAGMA user_version = ${version}`);
  }
  return version;
}

/** Resets the connection (used by tests and by "restore backup" flows). */
export async function closeDatabase(): Promise<void> {
  if (database) {
    await database.closeAsync();
    database = null;
    migrationPromise = null;
  }
}

export async function db(): Promise<SQLite.SQLiteDatabase> {
  return openAppDatabase();
}

export async function runSql(sql: string, params: SQLite.SQLiteBindParams = []): Promise<SQLite.SQLiteRunResult> {
  const handle = await db();
  return handle.runAsync(sql, params);
}

export async function allSql<T = SqlRow>(sql: string, params: SQLite.SQLiteBindParams = []): Promise<T[]> {
  const handle = await db();
  return handle.getAllAsync<T>(sql, params);
}

export async function firstSql<T = SqlRow>(sql: string, params: SQLite.SQLiteBindParams = []): Promise<T | null> {
  const handle = await db();
  return handle.getFirstAsync<T>(sql, params);
}

export async function execSql(sql: string): Promise<void> {
  const handle = await db();
  await handle.execAsync(sql);
}

export async function transaction<T>(task: (txn: SQLite.SQLiteDatabase) => Promise<T>): Promise<T> {
  const handle = await db();
  let output!: T;
  await handle.withExclusiveTransactionAsync(async (txn) => {
    output = await task(txn as unknown as SQLite.SQLiteDatabase);
  });
  return output;
}

/** Health check used by settings -> diagnostics and by the test suite. */
export async function databaseHealth(): Promise<{ version: number; tables: string[] }> {
  const handle = await db();
  const version = (await handle.getFirstAsync<{ user_version: number }>('PRAGMA user_version'))?.user_version ?? 0;
  const rows = await handle.getAllAsync<{ name: string }>(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
  );
  return { version, tables: rows.map((row) => row.name) };
}
