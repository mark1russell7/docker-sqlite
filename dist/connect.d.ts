/**
 * Connection utilities for SQLite using sql.js
 */
import { type Database } from "sql.js";
import type { ConnectionConfig, ConnectionCallback } from "./types.js";
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
export declare class DatabaseFileChangedError extends Error {
    readonly dbPath: string;
    /** A stable code for checks: `error.code === "DATABASE_FILE_CHANGED"`. */
    readonly code = "DATABASE_FILE_CHANGED";
    constructor(dbPath: string);
}
/**
 * The queue key of a file. Windows file names do not depend on case, so the key is in lower
 * case there. Before, two spellings of one file had two queues, and their calls ran at once.
 */
export declare function fileQueueKey(dbPath: string, platform?: NodeJS.Platform): string;
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
export declare function withConnection<T>(config: ConnectionConfig, fn: ConnectionCallback<T>): Promise<T>;
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
export declare function createConnection(config: ConnectionConfig): Promise<{
    db: Database;
    save: () => Promise<void>;
}>;
//# sourceMappingURL=connect.d.ts.map