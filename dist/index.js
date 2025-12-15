/**
 * docker-sqlite - Reusable SQLite Docker setup with TypeScript utilities
 *
 * @example
 * ```typescript
 * import { withConnection, query, execute, runMigrations } from 'docker-sqlite';
 *
 * // Define migrations
 * const migrations = [
 *   {
 *     version: 1,
 *     description: 'Create users table',
 *     up: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)',
 *     down: 'DROP TABLE users'
 *   }
 * ];
 *
 * // Run with auto-save
 * await withConnection({ dbPath: './data/app.db' }, (db) => {
 *   runMigrations(db, migrations);
 *
 *   execute(db, 'INSERT INTO users (name, email) VALUES (?, ?)', ['Alice', 'alice@example.com']);
 *
 *   const result = query(db, 'SELECT * FROM users');
 *   console.log(result.rows);
 * });
 * ```
 */
// Connection utilities
export { withConnection, createConnection } from "./connect.js";
// Query utilities
export { query, execute, execMultiple, lastInsertRowId, tableExists, } from "./query.js";
// Migration utilities
export { getMigrationStatus, runMigrations, rollbackMigration, createMigration, } from "./migrate.js";
//# sourceMappingURL=index.js.map