/**
 * Connection utilities for SQLite using sql.js
 */
import initSqlJs, {} from "sql.js";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { readFile, mkdir, open, rename, unlink } from "node:fs/promises";
import { dirname, resolve } from "node:path";
let sqlPromise = null;
/**
 * Initialize sql.js (cached)
 */
async function getSql() {
    if (!sqlPromise) {
        sqlPromise = initSqlJs();
    }
    return sqlPromise;
}
/**
 * Load a database from a file path or create a new one
 */
async function loadDatabase(dbPath) {
    const SQL = await getSql();
    if (dbPath === ":memory:") {
        return { db: new SQL.Database(), original: null };
    }
    try {
        const buffer = await readFile(dbPath);
        // sql.js keeps the array that it gets and writes into it: give it a copy, so `original`
        // keeps the bytes of the file
        return { db: new SQL.Database(new Uint8Array(buffer)), original: buffer };
    }
    catch (error) {
        if (error.code === "ENOENT") {
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
    dbPath;
    /** A stable code for checks: `error.code === "DATABASE_FILE_CHANGED"`. */
    code = "DATABASE_FILE_CHANGED";
    constructor(dbPath) {
        super(`The database file ${dbPath} changed after this connection loaded it: another connection or process wrote it. ` +
            "The save did not write, because it would replace those changes. Open a new connection and make the change again.");
        this.dbPath = dbPath;
        this.name = "DatabaseFileChangedError";
    }
}
/** The bytes of a file, or null when there is no file. */
async function readIfExists(path) {
    try {
        return await readFile(path);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            return null;
        }
        throw error;
    }
}
function sameBytes(a, b) {
    return a === null || b === null ? a === b : Buffer.compare(Buffer.from(a), Buffer.from(b)) === 0;
}
async function saveDatabase(db, dbPath, original, options = {}) {
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
    // The file must still have the bytes that this database came from. Else another connection
    // or process wrote it, and this save would replace its changes.
    if (options.refuseChangedFile && !sameBytes(await readIfExists(dbPath), original)) {
        throw new DatabaseFileChangedError(dbPath);
    }
    const buffer = Buffer.from(data);
    // Ensure directory exists
    await mkdir(dirname(dbPath), { recursive: true });
    // A random part, so two saves at once never share a temporary file. Before, the name had only
    // the process id and the time in milliseconds.
    const tempPath = `${dbPath}.${process.pid}.${randomUUID()}.tmp`;
    try {
        await writeDurably(tempPath, buffer);
    }
    catch (error) {
        await unlink(tempPath).catch(() => { });
        throw error;
    }
    try {
        await rename(tempPath, dbPath);
    }
    catch (error) {
        await unlink(tempPath).catch(() => { });
        // The file is held open on Windows: fall back to a direct write. Before, each error of the
        // rename started the direct write, which is not atomic.
        if (!FILE_IN_USE.has(error.code ?? "")) {
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
async function writeDurably(path, data) {
    const file = await open(path, "w");
    try {
        await file.writeFile(data);
        await file.sync();
    }
    finally {
        await file.close();
    }
}
/**
 * Flush a directory, so that a rename in it stays after a power loss. Windows cannot open a
 * directory for this, and some file systems refuse it: the flush is only an extra safety.
 */
async function syncDirectory(path) {
    if (process.platform === "win32") {
        return;
    }
    try {
        const directory = await open(path, "r");
        try {
            await directory.sync();
        }
        finally {
            await directory.close();
        }
    }
    catch {
        // The rename is done
    }
}
/**
 * The calls that wait for each database file. Each call reads the whole file, changes it in
 * memory and writes it back, so two calls at once lost the changes of one of them
 * (50 concurrent inserts kept 1 row). Calls for the same file now run one at a time in this
 * process. (Other processes that write the same file are not coordinated.)
 */
const fileQueues = new Map();
/**
 * The queue keys that the current call holds. A `save` of `createConnection` in a callback of
 * `withConnection` for the same file runs at once: in the queue, it would wait for the
 * callback, and the callback waits for it.
 */
const heldQueues = new AsyncLocalStorage();
/**
 * The queue key of a file. Windows file names do not depend on case, so the key is in lower
 * case there. Before, two spellings of one file had two queues, and their calls ran at once.
 */
export function fileQueueKey(dbPath, platform = process.platform) {
    const path = resolve(dbPath);
    return platform === "win32" ? path.toLowerCase() : path;
}
async function inFileQueue(dbPath, task, options = {}) {
    if (dbPath === ":memory:") {
        return task();
    }
    const key = fileQueueKey(dbPath);
    const held = heldQueues.getStore();
    if (options.reentrant && held?.has(key)) {
        return task();
    }
    const holding = new Set(held).add(key);
    const start = () => heldQueues.run(holding, task);
    const previous = fileQueues.get(key) ?? Promise.resolve();
    const run = previous.then(start, start);
    const tail = run.then(() => undefined, () => undefined);
    fileQueues.set(key, tail);
    try {
        return await run;
    }
    finally {
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
export async function withConnection(config, fn) {
    return inFileQueue(config.dbPath, async () => {
        const { db, original } = await loadDatabase(config.dbPath);
        try {
            const result = await fn(db);
            // Save changes back to file (only when there are changes)
            await saveDatabase(db, config.dbPath, original);
            return result;
        }
        finally {
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
export async function createConnection(config) {
    const { db, original } = await loadDatabase(config.dbPath);
    // The bytes of the file after the last save, to compare the next save with
    let saved = original;
    const save = () => inFileQueue(config.dbPath, async () => {
        saved = await saveDatabase(db, config.dbPath, saved, { refuseChangedFile: true });
    }, { reentrant: true });
    return { db, save };
}
//# sourceMappingURL=connect.js.map