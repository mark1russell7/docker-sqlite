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
export function query<T = Record<string, unknown>>(
  db: Database,
  sql: string,
  params: unknown[] = []
): QueryResult<T> {
  const stmt = db.prepare(sql);

  try {
    stmt.bind(params as (string | number | Uint8Array | null)[]);

    const rows: T[] = [];
    let columns: string[] = [];

    while (stmt.step()) {
      if (columns.length === 0) {
        columns = stmt.getColumnNames();
      }
      rows.push(stmt.getAsObject() as T);
    }

    return { columns, rows };
  } finally {
    stmt.free();
  }
}

/**
 * Execute an INSERT, UPDATE, DELETE, or other statement
 *
 * @example
 * ```typescript
 * const result = execute(db, 'INSERT INTO users (name, age) VALUES (?, ?)', ['Bob', 30]);
 * console.log(result.changes); // 1
 * ```
 */
export function execute(
  db: Database,
  sql: string,
  params: unknown[] = []
): ExecuteResult {
  // With parameters, sql.js runs only the first statement. Before, the other statements were
  // ignored and the call reported success. Now several statements run with no parameters, and
  // are an error with parameters.
  if (hasSeveralStatements(db, sql)) {
    if (params.length > 0) {
      throw new Error(
        "execute() binds parameters to one statement, and the SQL has several. Send one statement per call."
      );
    }
    const before = totalChanges(db);
    db.exec(sql);
    return { changes: totalChanges(db) - before };
  }
  db.run(sql, params as (string | number | Uint8Array | null)[]);
  const changes = db.getRowsModified();
  return { changes };
}

/** The number of rows that the statements of this connection changed. */
function totalChanges(db: Database): number {
  const result = db.exec("SELECT total_changes()");
  return Number(result[0]?.values[0]?.[0] ?? 0);
}

/** True when the text holds SQL other than spaces, ";" and comments. */
function holdsStatement(sql: string): boolean {
  return sql
    .replace(/--[^\n]*/g, "")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/[\s;]/g, "")
    .length > 0;
}

/**
 * True when `sql` holds more than one statement. Nothing runs: the function only prepares the
 * first statement and examines the SQL after it.
 */
export function hasSeveralStatements(db: Database, sql: string): boolean {
  const iterator = db.iterateStatements(sql);
  const first = iterator.next();
  if (first.done) {
    return false;
  }
  const rest = iterator.getRemainingSQL();
  // Read the iterator to its end: this frees the statement and the copy of the SQL. A later
  // statement can fail to prepare (its table does not exist yet), and that also ends it.
  try {
    while (!iterator.next().done) {
      // Prepare only
    }
  } catch {
    // The iterator ended
  }
  return holdsStatement(rest);
}

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
export function execMultiple(db: Database, sql: string): void {
  db.exec(sql);
}

/**
 * Get the last inserted row ID
 */
export function lastInsertRowId(db: Database): number {
  const result = query<{ id: number }>(db, "SELECT last_insert_rowid() as id");
  return result.rows[0]?.id ?? 0;
}

/**
 * Check if a table exists
 */
export function tableExists(db: Database, tableName: string): boolean {
  const result = query<{ name: string }>(
    db,
    "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
    [tableName]
  );
  return result.rows.length > 0;
}
