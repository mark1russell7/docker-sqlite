/**
 * Connection utilities for SQLite using sql.js
 */
import initSqlJs, {} from "sql.js";
import { readFile, writeFile, mkdir, rename, unlink } from "node:fs/promises";
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
        return new SQL.Database();
    }
    try {
        const buffer = await readFile(dbPath);
        return new SQL.Database(buffer);
    }
    catch (error) {
        if (error.code === "ENOENT") {
            // File doesn't exist, create new database
            return new SQL.Database();
        }
        throw error;
    }
}
/**
 * Save a database to a file path.
 *
 * Writes a temporary file and renames it over the database, so a crash during the write
 * cannot leave a truncated database (the rename replaces the file in one step).
 */
async function saveDatabase(db, dbPath) {
    if (dbPath === ":memory:") {
        return;
    }
    const data = db.export();
    const buffer = Buffer.from(data);
    // Ensure directory exists
    await mkdir(dirname(dbPath), { recursive: true });
    const tempPath = `${dbPath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, buffer);
    try {
        await rename(tempPath, dbPath);
    }
    catch {
        // For example, the file is held open on Windows: fall back to a direct write
        await unlink(tempPath).catch(() => { });
        await writeFile(dbPath, buffer);
    }
}
/**
 * The calls that wait for each database file. Each call reads the whole file, changes it in
 * memory and writes it back, so two calls at once lost the changes of one of them
 * (50 concurrent inserts kept 1 row). Calls for the same file now run one at a time in this
 * process. (Other processes that write the same file are not coordinated.)
 */
const fileQueues = new Map();
async function inFileQueue(dbPath, task) {
    if (dbPath === ":memory:") {
        return task();
    }
    const key = resolve(dbPath);
    const previous = fileQueues.get(key) ?? Promise.resolve();
    const run = previous.then(task, task);
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
        const db = await loadDatabase(config.dbPath);
        try {
            const result = await fn(db);
            // Save changes back to file
            await saveDatabase(db, config.dbPath);
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
    const db = await loadDatabase(config.dbPath);
    const save = () => saveDatabase(db, config.dbPath);
    return { db, save };
}
//# sourceMappingURL=connect.js.map