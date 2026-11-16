/**
 * Connection utilities for SQLite using sql.js
 */

import initSqlJs, { type Database } from "sql.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, open, rename, stat, unlink } from "node:fs/promises";
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
    await refuseLiveWal(dbPath, buffer);
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
 * Writes a temporary file, flushes it to the disk and renames it over the database, so a crash
 * or a power loss during the write cannot leave a truncated database (the rename replaces the
 * file in one step).
 */
/**
 * The error of the `save` of `createConnection` when the file changed after the connection
 * loaded it or saved it last. Another connection or process wrote the file. The save does not
 * write: it would replace those changes with the old copy of this connection.
 */
export class DatabaseFileChangedError extends Error {
  /** A stable code for checks: `error.code === "DATABASE_FILE_CHANGED"`. */
  readonly code = "DATABASE_FILE_CHANGED";
  /** The path of the file that changed. */
  readonly dbPath: string;

  constructor(dbPath: string) {
    super(
      `The database file ${dbPath} changed after this connection loaded it: another connection or process wrote it. ` +
        "The save did not write, because it would replace those changes. Open a new connection and make the change again."
    );
    this.dbPath = dbPath;
    this.name = "DatabaseFileChangedError";
  }
}

/**
 * The error of `withConnection`, `createConnection` and `save` for a file in WAL mode with a WAL
 * file (`<path>-wal`) or a shared-memory file (`<path>-shm`). Another connection, for example of
 * `node:sqlite`, has the file open, or it stopped before its close. sql.js reads only the main
 * file. Thus it reads old rows, and the other connection writes over its save. The call does not
 * read or write the file.
 */
export class WalFileInUseError extends Error {
  /** A stable code for checks: `error.code === "WAL_FILE_IN_USE"`. */
  readonly code = "WAL_FILE_IN_USE";
  /** The path of the database file. */
  readonly dbPath: string;
  /** The path of the side file that the check found: `<path>-wal` or `<path>-shm`. */
  readonly sideFile: string;

  constructor(dbPath: string, sideFile: string) {
    super(
      `The database file ${dbPath} is in WAL mode, and ${sideFile} exists: another connection has the file open, or it stopped before its close. ` +
        "sql.js reads only the main file: it would read old rows, and the other connection would write over its changes. " +
        "Use a driver that reads the WAL file, for example @mark1russell7/sqlite on Node.js 22.13 or later. " +
        "Or close the other connection. When no process has the file open, open and close it once with SQLite: SQLite then copies the WAL file into the main file and removes the side files."
    );
    this.dbPath = dbPath;
    this.sideFile = sideFile;
    this.name = "WalFileInUseError";
  }
}

/**
 * Tells if the header of a database file sets WAL mode. SQLite writes 2 into the bytes 18 and 19
 * (the versions of the file format for a write and a read) of a file in WAL mode.
 */
function walHeader(bytes: Uint8Array): boolean {
  return bytes.length >= 20 && bytes[18] === 2 && bytes[19] === 2;
}

/**
 * The side files of a file in WAL mode. A connection makes them at its first statement, and the
 * clean close of the last connection removes them. A connection in the locking mode EXCLUSIVE
 * makes no shared-memory file, but it makes the WAL file.
 */
const WAL_SIDE_FILES = ["-wal", "-shm"] as const;

/** Gives the path of the first side file of a file in WAL mode that exists, or null. */
async function walSideFile(dbPath: string): Promise<string | null> {
  for (const suffix of WAL_SIDE_FILES) {
    const path = `${dbPath}${suffix}`;
    try {
      await stat(path);
      return path;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }
  return null;
}

/**
 * Throws a `WalFileInUseError` when the file is in WAL mode and its WAL file or its shared-memory
 * file exists. A file in WAL mode with neither file has all of its rows in the main file, and no
 * connection that ran a statement has it open. Thus sql.js reads it correctly.
 */
async function refuseLiveWal(dbPath: string, bytes: Uint8Array | null): Promise<void> {
  if (bytes === null || !walHeader(bytes)) {
    return;
  }
  const sideFile = await walSideFile(dbPath);
  if (sideFile !== null) {
    throw new WalFileInUseError(dbPath, sideFile);
  }
}

/**
 * Gets the bytes that a database with no content exports. The bytes depend on the version of
 * sql.js: version 1.14 exports no bytes, and version 1.15 exports one page.
 */
async function emptyDatabaseBytes(): Promise<Uint8Array> {
  const SQL = await getSql();
  const empty = new SQL.Database();
  try {
    return empty.export();
  } finally {
    empty.close();
  }
}

/** The bytes of a file, or null when there is no file. */
async function readIfExists(path: string): Promise<Uint8Array | null> {
  try {
    return await readFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function sameBytes(a: Uint8Array | null, b: Uint8Array | null): boolean {
  return a === null || b === null ? a === b : Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}

async function saveDatabase(
  db: Database,
  dbPath: string,
  original: Uint8Array | null,
  options: { refuseChangedFile?: boolean } = {}
): Promise<Uint8Array | null> {
  if (dbPath === ":memory:") {
    return null;
  }

  const data = db.export();
  const unchanged = sameBytes(data, original ?? (await emptyDatabaseBytes()));
  if (unchanged) {
    return original;
  }
  // The file must still have the bytes that this database came from. Else another connection
  // or process wrote it, and this save would replace its changes.
  const onDisk = await readIfExists(dbPath);
  if (options.refuseChangedFile && !sameBytes(onDisk, original)) {
    throw new DatabaseFileChangedError(dbPath);
  }
  // A connection of a different driver can open the file in WAL mode after the load. Its rows
  // are in the WAL file, so the main file does not change. A checkpoint of that connection
  // writes its pages over this save, and its next frames apply to the wrong file.
  await refuseLiveWal(dbPath, onDisk);
  const buffer = Buffer.from(data);

  // Ensure directory exists
  await mkdir(dirname(dbPath), { recursive: true });

  // A random part, so two saves at once never share a temporary file. Before, the name had only
  // the process id and the time in milliseconds.
  const tempPath = `${dbPath}.${process.pid}.${randomUUID()}.tmp`;
  try {
    await writeDurably(tempPath, buffer);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    throw error;
  }
  try {
    await rename(tempPath, dbPath);
  } catch (error) {
    await unlink(tempPath).catch(() => {});
    // The file is held open on Windows: fall back to a direct write. Before, each error of the
    // rename started the direct write, which is not atomic.
    if (!FILE_IN_USE.has((error as NodeJS.ErrnoException).code ?? "")) {
      throw error;
    }
    await writeDurably(dbPath, buffer);
  }
  await syncDirectory(dirname(dbPath));
  return data;
}

/** The error codes of a rename over a file that another process holds open (Windows). */
const FILE_IN_USE = new Set(["EPERM", "EACCES", "EBUSY"]);

/**
 * Write a file and flush it to the disk before the rename. Without the flush, a power loss soon
 * after the rename can leave an empty or partial database on some file systems.
 */
async function writeDurably(path: string, data: Uint8Array): Promise<void> {
  const file = await open(path, "w");
  try {
    await file.writeFile(data);
    await file.sync();
  } finally {
    await file.close();
  }
}

/**
 * Flush a directory, so that a rename in it stays after a power loss. Windows cannot open a
 * directory for this, and some file systems refuse it: the flush is only an extra safety.
 */
async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  try {
    const directory = await open(path, "r");
    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch {
    // The rename is done
  }
}

/**
 * The calls that wait for each database file. Each call reads the whole file, changes it in
 * memory and writes it back, so two calls at once lost the changes of one of them
 * (50 concurrent inserts kept 1 row). Calls for the same file now run one at a time in this
 * process. (Other processes that write the same file are not coordinated.)
 */
const fileQueues = new Map<string, Promise<unknown>>();

/** One queue key that a call holds, while the call runs. */
interface HeldQueue {
  readonly key: string;
  /** False after the call ended. */
  active: boolean;
}

/**
 * The queue keys that the current call holds. A `save` of `createConnection` in a callback of
 * `withConnection` for the same file runs at once: in the queue, it would wait for the
 * callback, and the callback waits for it.
 *
 * The callback gives this store also to work that ends after the callback, for example a timer.
 * A key counts only while its call runs. Before, a save of such work ran at once also after the
 * call ended, beside the next call for the same file, and that call wrote over the save.
 */
const heldQueues = new AsyncLocalStorage<readonly HeldQueue[]>();

/**
 * The queue key of a file. Windows file names do not depend on case, so the key is in lower
 * case there. Before, two spellings of one file had two queues, and their calls ran at once.
 */
export function fileQueueKey(dbPath: string, platform: NodeJS.Platform = process.platform): string {
  const path = resolve(dbPath);
  return platform === "win32" ? path.toLowerCase() : path;
}

async function inFileQueue<T>(
  dbPath: string,
  task: () => Promise<T>,
  options: { reentrant?: boolean } = {}
): Promise<T> {
  if (dbPath === ":memory:") {
    return task();
  }
  const key = fileQueueKey(dbPath);
  const held = (heldQueues.getStore() ?? []).filter((item) => item.active);
  if (options.reentrant && held.some((item) => item.key === key)) {
    return task();
  }
  const hold: HeldQueue = { key, active: true };
  const holding = [...held, hold];
  const start = (): Promise<T> =>
    heldQueues.run(holding, async () => {
      try {
        return await task();
      } finally {
        hold.active = false;
      }
    });
  const previous = fileQueues.get(key) ?? Promise.resolve();
  const run = previous.then(start, start);
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
 * The call throws a `DatabaseFileChangedError` and does not write when the database changed and
 * the file changed during the callback, for example by a `save` of `createConnection` in the
 * callback or by another process. Before, it wrote its old copy over those changes.
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
      // Save changes back to file (only when there are changes). A save of `createConnection` in
      // the callback can write the file: then this save refuses its old copy, as that save does.
      await saveDatabase(db, config.dbPath, original, { refuseChangedFile: true });
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
 * `save` runs in the queue of the file, one call at a time with `withConnection` and the other
 * saves of this process. It throws a `DatabaseFileChangedError` and does not write when the
 * file changed after this connection loaded it or saved it last. Before, it wrote its old copy
 * over the changes of the other connection or process. After the error, open a new connection.
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
  const save = (): Promise<void> =>
    inFileQueue(
      config.dbPath,
      async () => {
        saved = await saveDatabase(db, config.dbPath, saved, { refuseChangedFile: true });
      },
      { reentrant: true }
    );
  return { db, save };
}
