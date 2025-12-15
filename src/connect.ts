/**
 * Connection utilities for SQLite using sql.js
 */

import initSqlJs, { type Database } from "sql.js";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import type { ConnectionConfig, ConnectionCallback } from "./types.js";

let sqlPromise: Promise<Awaited<ReturnType<typeof initSqlJs>>> | null = null;

/**
 * Initialize sql.js (cached)
 */
async function getSql(): Promise<Awaited<ReturnType<typeof initSqlJs>>> {
  if (!sqlPromise) {
    sqlPromise = initSqlJs();
  }
  return sqlPromise;
}

/**
 * Load a database from a file path or create a new one
 */
async function loadDatabase(dbPath: string): Promise<Database> {
  const SQL = await getSql();

  if (dbPath === ":memory:") {
    return new SQL.Database();
  }

  try {
    const buffer = await readFile(dbPath);
    return new SQL.Database(buffer);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist, create new database
      return new SQL.Database();
    }
    throw error;
  }
}

/**
 * Save a database to a file path
 */
async function saveDatabase(db: Database, dbPath: string): Promise<void> {
  if (dbPath === ":memory:") {
    return;
  }

  const data = db.export();
  const buffer = Buffer.from(data);

  // Ensure directory exists
  await mkdir(dirname(dbPath), { recursive: true });
  await writeFile(dbPath, buffer);
}

/**
 * Execute a callback with a SQLite connection, ensuring proper cleanup and persistence.
 *
 * @example
 * ```typescript
 * const result = await withConnection(
 *   { dbPath: './data/app.db' },
 *   async (db) => {
 *     const stmt = db.prepare('SELECT * FROM users WHERE id = ?');
 *     stmt.bind([1]);
 *     const rows = [];
 *     while (stmt.step()) {
 *       rows.push(stmt.getAsObject());
 *     }
 *     stmt.free();
 *     return rows;
 *   }
 * );
 * ```
 */
export async function withConnection<T>(
  config: ConnectionConfig,
  fn: ConnectionCallback<T>
): Promise<T> {
  const db = await loadDatabase(config.dbPath);

  try {
    const result = await fn(db);
    // Save changes back to file
    await saveDatabase(db, config.dbPath);
    return result;
  } finally {
    db.close();
  }
}

/**
 * Create a SQLite database that can be manually managed.
 * Caller is responsible for calling db.close() and saving if needed.
 *
 * @example
 * ```typescript
 * const { db, save } = await createConnection({ dbPath: './data/app.db' });
 * try {
 *   db.run('INSERT INTO users (name) VALUES (?)', ['Alice']);
 *   await save();
 * } finally {
 *   db.close();
 * }
 * ```
 */
export async function createConnection(
  config: ConnectionConfig
): Promise<{ db: Database; save: () => Promise<void> }> {
  const db = await loadDatabase(config.dbPath);
  const save = () => saveDatabase(db, config.dbPath);
  return { db, save };
}
