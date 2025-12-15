/**
 * Migration utilities for SQLite
 */
import type { Database } from "sql.js";
import type { Migration, MigrationStatus } from "./types.js";
/**
 * Get the current migration status
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
 */
export declare function runMigrations(db: Database, migrations: Migration[]): Migration[];
/**
 * Rollback the last applied migration
 */
export declare function rollbackMigration(db: Database, migrations: Migration[]): Migration | null;
/**
 * Create a migration from SQL strings
 */
export declare function createMigration(version: number, description: string, up: string, down?: string): Migration;
//# sourceMappingURL=migrate.d.ts.map