/**
 * Query helper utilities for SQLite
 */
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
export function query(db, sql, params = []) {
    const stmt = db.prepare(sql);
    try {
        stmt.bind(params);
        const rows = [];
        let columns = [];
        while (stmt.step()) {
            if (columns.length === 0) {
                columns = stmt.getColumnNames();
            }
            rows.push(stmt.getAsObject());
        }
        return { columns, rows };
    }
    finally {
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
export function execute(db, sql, params = []) {
    db.run(sql, params);
    const changes = db.getRowsModified();
    return { changes };
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
export function execMultiple(db, sql) {
    db.exec(sql);
}
/**
 * Get the last inserted row ID
 */
export function lastInsertRowId(db) {
    const result = query(db, "SELECT last_insert_rowid() as id");
    return result.rows[0]?.id ?? 0;
}
/**
 * Check if a table exists
 */
export function tableExists(db, tableName) {
    const result = query(db, "SELECT name FROM sqlite_master WHERE type='table' AND name=?", [tableName]);
    return result.rows.length > 0;
}
//# sourceMappingURL=query.js.map