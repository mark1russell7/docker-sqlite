/**
 * Connection utilities for SQLite using sql.js
 */

import initSqlJs, { type Database } from "sql.js";
import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
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

/** A database and the bytes of its file when it was loaded (null: there was no file). */
interface LoadedDatabase {
  db: Database;
  original: Uint8Array | null;
}

/**
 * Load a database from a file path or create a new one
 */
async function loadDatabase(dbPath: string): Promise<LoadedDatabase> {
  const SQL = await getSql();

  if (dbPath === ":memory:") {
    return { db: new SQL.Database(), original: null };
  }

  try {
    const buffer = await readFile(dbPath);
    // sql.js keeps the array that it gets and writes into it: give it a copy, so `original`
    // keeps the bytes of the file
    return { db: new SQL.Database(new Uint8Array(buffer)), original: buffer };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      // File doesn't exist, create new database
      return { db: new SQL.Database(), original: null };
    }
    throw error;
  }
}

/**
 * Save a database to a file path, when its content changed.
 *
 * A database that did not change is not written. Before, each call wrote the file, also a
 * read: a read failed on a read-only file (EPERM), a read wrote an old copy over the rows of
 * another process, and a query of a missing file made an empty file. The export of a
 * database that did not change has the bytes of its file, and an empty new database exports
 * no bytes.
 *
 * Writes a temporary file and renames it over the database, so a crash during the write
 * cannot leave a truncated database (the rename replaces the file in one step).
 */
async function saveDatabase(db: Database, dbPath: string, original: Uint8Array | null): Promise<Uint8Array | null> {
  if (dbPath === ":memory:") {
    return null;
  }

  const data = db.export();
  const unchanged = original
    ? Buffer.compare(Buffer.from(data), Buffer.from(original)) === 0
    : data.length === 0;
  if (unchanged) {
    return original;
  }
  const buffer = Buffer.from(data);

  // Ensure directory exists
  await mkdir(dirname(dbPath), { recursive: true });

  const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
  await writeFile(tempPath, buffer);
  try {
    await rename(tempPath, dbPath);
  } catch {
    // For example, the file is held open on Windows: fall back to a direct write
    await unlink(tempPath).catch(() => {});
    await writeFile(dbPath, buffer);
  }
  return data;
}

/**
 * The calls that wait for each database file. Each call reads the whole file, changes it in
 * memory and writes it back, so two calls at once lost the changes of one of them
 * (50 concurrent inserts kept 1 row). Calls for the same file now run one at a time in this
 * process. (Other processes that write the same file are not coordinated.)
 */
const fileQueues = new Map<string, Promise<unknown>>();

/**
 * The queue key of a file. Windows file names do not depend on case, so the key is in lower
 * case there. Before, two spellings of one file had two queues, and their calls ran at once.
 */
export function fileQueueKey(dbPath: string, platform: NodeJS.Platform = process.platform): string {
  const path = resolve(dbPath);
  return platform === "win32" ? path.toLowerCase() : path;
}

async function inFileQueue<T>(dbPath: string, task: () => Promise<T>): Promise<T> {
  if (dbPath === ":memory:") {
    return task();
  }
  const key = fileQueueKey(dbPath);
  const previous = fileQueues.get(key) ?? Promise.resolve();
  const run = previous.then(task, task);
  const tail = run.then(
    () => undefined,
    () => undefined
  );
  fileQueues.set(key, tail);
  try {
    return await run;
  } finally {
    if (fileQueues.get(key) === tail) {
      fileQueues.delete(key);
    }
  }
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
  return inFileQueue(config.dbPath, async () => {
    const { db, original } = await loadDatabase(config.dbPath);

    try {
      const result = await fn(db);
      // Save changes back to file (only when there are changes)
      await saveDatabase(db, config.dbPath, original);
      return result;
    } finally {
      db.close();
    }
  });
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
  const { db, original } = await loadDatabase(config.dbPath);
  // The bytes of the file after the last save, to compare the next save with
  let saved = original;
  const save = async (): Promise<void> => {
    saved = await saveDatabase(db, config.dbPath, saved);
  };
  return { db, save };
}
