/**
 * docker-sqlite - Reusable SQLite Docker setup with TypeScript utilities
 *
 * The query functions, the migrations and the entry `/pure` are deprecated since 0.3.3. Their home is
 * `@mark1russell7/sqlite/portable`. `withConnection` and `createConnection` keep a file of sql.js, and they are not deprecated.
 *
 * @example
 * ```typescript
 * import { withConnection } from '@mark1russell7/docker-sqlite';
 * import { migrate, sqlJsConnection } from '@mark1russell7/sqlite/portable';
 *
 * // Save the file when the callback changed the database
 * await withConnection({ dbPath: './data/app.db' }, (db) => {
 *   const connection = sqlJsConnection(db);
 *   migrate(connection, ['CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)']);
 *
 *   connection.prepare('INSERT INTO users (name, email) VALUES (?, ?)').run('Alice', 'alice@example.com');
 *
 *   console.log(connection.prepare('SELECT * FROM users').all());
 * });
 * ```
 */
// Connection utilities
export { withConnection, createConnection, DatabaseFileChangedError, WalFileInUseError } from "./connect.js";
// Query utilities
export { query, execute, execMultiple, lastInsertRowId, tableExists, } from "./query.js";
// Migration utilities
export { getMigrationStatus, runMigrations, rollbackMigration, createMigration, } from "./migrate.js";
//# sourceMappingURL=index.js.map