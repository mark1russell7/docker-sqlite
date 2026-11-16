/**
 * Migration utilities for SQLite
 *
 * These functions are deprecated since 0.3.3. Their home is `migrate` of `@mark1russell7/sqlite/portable`. The README of this
 * package tells how to move a file that `runMigrations` migrated.
 */
import type { Database } from "sql.js";
import type { Migration, MigrationStatus } from "./types.js";
/**
 * Get the current migration status
 *
 * @deprecated Since 0.3.3. Use `userVersion` of `@mark1russell7/sqlite/portable`: the steps after that version are pending.
 */
export declare function getMigrationStatus(db: Database, migrations: Migration[]): MigrationStatus;
/**
 * Run all pending migrations
 *
 * @example
 * ```typescript
 * const migrations: Migration[] = [
 *   {
 *     version: 1,
 *     description: 'Create users table',
 *     up: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
 *     down: 'DROP TABLE users'
 *   },
 *   {
 *     version: 2,
 *     description: 'Add email column',
 *     up: 'ALTER TABLE users ADD COLUMN email TEXT',
 *   }
 * ];
 *
 * const applied = runMigrations(db, migrations);
 * console.log(`Applied ${applied.length} migrations`);
 * ```
 *
 * @deprecated Since 0.3.3. Use `migrate(sqlJsConnection(db), steps)` of `@mark1russell7/sqlite/portable`. The step `i` of the list gives the
 * version `i + 1`. The README of this package tells how to move a file.
 */
export declare function runMigrations(db: Database, migrations: Migration[]): Migration[];
/**
 * Rollback the last applied migration
 *
 * @deprecated Since 0.3.3. The home `@mark1russell7/sqlite` has no down migration. Write the change as a new step of
 * `migrate`.
 */
export declare function rollbackMigration(db: Database, migrations: Migration[]): Migration | null;
/**
 * Create a migration from SQL strings
 *
 * @deprecated Since 0.3.3. A step of `migrate` of `@mark1russell7/sqlite/portable` is a SQL text or a function of the connection.
 */
export declare function createMigration(version: number, description: string, up: string, down?: string): Migration;
//# sourceMappingURL=migrate.d.ts.map