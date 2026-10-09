/**
 * Query helper utilities for SQLite
 */
import type { Database } from "sql.js";
import type { QueryResult, ExecuteResult } from "./types.js";
/**
 * Execute a SELECT query and return results
 *
 * @example
 * ```typescript
 * const result = query(db, 'SELECT * FROM users WHERE age > ?', [21]);
 * console.log(result.columns); // ['id', 'name', 'age']
 * console.log(result.rows);    // [{ id: 1, name: 'Alice', age: 25 }, ...]
 * ```
 */
export declare function query<T = Record<string, unknown>>(db: Database, sql: string, params?: unknown[]): QueryResult<T>;
/**
 * Execute an INSERT, UPDATE, DELETE, or other statement
 *
 * @example
 * ```typescript
 * const result = execute(db, 'INSERT INTO users (name, age) VALUES (?, ?)', ['Bob', 30]);
 * console.log(result.changes); // 1
 * ```
 */
export declare function execute(db: Database, sql: string, params?: unknown[]): ExecuteResult;
/**
 * True when `sql` holds more than one statement. Nothing runs: the function only prepares the
 * first statement and examines the SQL after it.
 */
export declare function hasSeveralStatements(db: Database, sql: string): boolean;
/**
 * Execute multiple statements (for schema setup, etc.)
 *
 * @example
 * ```typescript
 * execMultiple(db, `
 *   CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT);
 *   CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, user_id INTEGER);
 * `);
 * ```
 */
export declare function execMultiple(db: Database, sql: string): void;
/**
 * Get the last inserted row ID
 */
export declare function lastInsertRowId(db: Database): number;
/**
 * Check if a table exists
 */
export declare function tableExists(db: Database, tableName: string): boolean;
//# sourceMappingURL=query.d.ts.map