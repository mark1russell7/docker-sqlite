/**
 * Migration utilities for SQLite
 */

import type { Database } from "sql.js";
import type { Migration, MigrationStatus } from "./types.js";
import { query, execute, execMultiple } from "./query.js";

/**
 * Schema for tracking migrations
 */
const MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS _migrations (
    version INTEGER PRIMARY KEY,
    description TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

/**
 * Ensure the migrations table exists
 */
function ensureMigrationsTable(db: Database): void {
  execMultiple(db, MIGRATIONS_TABLE_SQL);
}

/**
 * Get the current migration status
 */
export function getMigrationStatus(
  db: Database,
  migrations: Migration[]
): MigrationStatus {
  ensureMigrationsTable(db);

  const applied = query<{ version: number }>(
    db,
    "SELECT version FROM _migrations ORDER BY version"
  );

  const appliedVersions = new Set(applied.rows.map((r) => r.version));
  const appliedMigrations = [...appliedVersions].sort((a, b) => a - b);
  const currentVersion =
    appliedMigrations.length > 0
      ? appliedMigrations[appliedMigrations.length - 1]!
      : 0;

  const pendingMigrations = migrations
    .filter((m) => !appliedVersions.has(m.version))
    .sort((a, b) => a.version - b.version);

  return {
    currentVersion,
    appliedMigrations,
    pendingMigrations,
  };
}

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
export function runMigrations(db: Database, migrations: Migration[]): Migration[] {
  const status = getMigrationStatus(db, migrations);
  const applied: Migration[] = [];

  for (const migration of status.pendingMigrations) {
    try {
      // Run the migration
      execMultiple(db, migration.up);

      // Record it as applied
      execute(
        db,
        "INSERT INTO _migrations (version, description) VALUES (?, ?)",
        [migration.version, migration.description]
      );

      applied.push(migration);
    } catch (error) {
      throw new Error(
        `Failed to apply migration ${migration.version} (${migration.description}): ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  return applied;
}

/**
 * Rollback the last applied migration
 */
export function rollbackMigration(
  db: Database,
  migrations: Migration[]
): Migration | null {
  const status = getMigrationStatus(db, migrations);

  if (status.currentVersion === 0) {
    return null;
  }

  const migration = migrations.find((m) => m.version === status.currentVersion);

  if (!migration) {
    throw new Error(`Migration ${status.currentVersion} not found in migrations list`);
  }

  if (!migration.down) {
    throw new Error(
      `Migration ${migration.version} (${migration.description}) has no down migration`
    );
  }

  try {
    execMultiple(db, migration.down);
    execute(db, "DELETE FROM _migrations WHERE version = ?", [migration.version]);
    return migration;
  } catch (error) {
    throw new Error(
      `Failed to rollback migration ${migration.version}: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create a migration from SQL strings
 */
export function createMigration(
  version: number,
  description: string,
  up: string,
  down?: string
): Migration {
  const migration: Migration = { version, description, up };
  if (down !== undefined) {
    migration.down = down;
  }
  return migration;
}
