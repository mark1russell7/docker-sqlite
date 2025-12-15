/**
 * Connection utilities for SQLite using sql.js
 */
import { type Database } from "sql.js";
import type { ConnectionConfig, ConnectionCallback } from "./types.js";
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