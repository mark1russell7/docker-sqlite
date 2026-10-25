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

/** The name of the savepoint that holds one migration and its record. */
const SAVEPOINT = "docker_sqlite_migration";

/**
 * The first words of the statements that control transactions, cannot run in a transaction
 * (VACUUM, ATTACH) or can do nothing there (PRAGMA foreign_keys).
 */
const OUTSIDE_A_TRANSACTION = new Set([
  "BEGIN",
  "COMMIT",
  "END",
  "ROLLBACK",
  "SAVEPOINT",
  "RELEASE",
  "VACUUM",
  "ATTACH",
  "DETACH",
  "PRAGMA",
]);

/**
 * The tokens of SQL text: the words in upper case, ";" for each semicolon, and "?" for each
 * other token. Comments are skipped. A string or a quoted name is one "?" token, so a word in it
 * is not a keyword.
 */
function* tokens(sql: string): Generator<string> {
  const word = /[\p{L}_][\p{L}\p{N}_$]*/uy;
  let i = 0;
  while (i < sql.length) {
    const c = sql[i]!;
    if (/\s/.test(c)) {
      i++;
    } else if (c === "-" && sql[i + 1] === "-") {
      const end = sql.indexOf("\n", i);
      i = end < 0 ? sql.length : end + 1;
    } else if (c === "/" && sql[i + 1] === "*") {
      const end = sql.indexOf("*/", i + 2);
      i = end < 0 ? sql.length : end + 2;
    } else if (c === "'" || c === '"' || c === "`" || c === "[") {
      // A quote in the text is two quotes. A name in brackets cannot hold "]".
      const close = c === "[" ? "]" : c;
      let end = sql.indexOf(close, i + 1);
      while (end >= 0 && close !== "]" && sql[end + 1] === close) {
        end = sql.indexOf(close, end + 2);
      }
      i = end < 0 ? sql.length : end + 1;
      yield "?";
    } else if (c === ";") {
      i++;
      yield ";";
    } else {
      word.lastIndex = i;
      const match = word.exec(sql);
      if (match) {
        i += match[0].length;
        yield match[0].toUpperCase();
      } else {
        i++;
        yield "?";
      }
    }
  }
}

/**
 * The first word of each statement of `sql`, in upper case. The statements in the body of a
 * trigger are part of the trigger: like sqlite3_complete(), the trigger ends at "; END ;".
 */
function statementKeywords(sql: string): string[] {
  const keywords: string[] = [];
  let words: string[] = [];
  let trigger = false;
  let afterSemicolon = false;
  let afterEnd = false;
  for (const token of tokens(sql)) {
    if (token === ";") {
      if (!trigger || afterEnd) {
        words = [];
        trigger = false;
        afterEnd = false;
      } else {
        afterSemicolon = true;
      }
      continue;
    }
    if (words.length === 0) {
      keywords.push(token);
    }
    if (words.length < 3) {
      words.push(token);
      const [first, second, third] = words;
      trigger ||=
        first === "CREATE" &&
        (second === "TRIGGER" || ((second === "TEMP" || second === "TEMPORARY") && third === "TRIGGER"));
    }
    afterEnd = trigger && afterSemicolon && token === "END";
    afterSemicolon = false;
  }
  return keywords;
}

/**
 * Run `work` in a savepoint: its changes stay only when it succeeds. Before, a migration that
 * failed after its first statement kept the changes of those statements, and was not recorded:
 * the next run ran it again and failed ("table already exists").
 *
 * A savepoint also works in a transaction of the caller, and keeps that transaction open. SQL
 * that controls transactions itself (BEGIN, COMMIT, VACUUM, PRAGMA and the others in
 * OUTSIDE_A_TRANSACTION) runs without a savepoint, as before: in a transaction it fails or does
 * nothing.
 */
function atomically(db: Database, sql: string, work: () => void): void {
  if (statementKeywords(sql).some((keyword) => OUTSIDE_A_TRANSACTION.has(keyword))) {
    work();
    return;
  }
  db.exec(`SAVEPOINT ${SAVEPOINT}`);
  try {
    work();
    db.exec(`RELEASE ${SAVEPOINT}`);
  } catch (error) {
    try {
      db.exec(`ROLLBACK TO ${SAVEPOINT}`);
      db.exec(`RELEASE ${SAVEPOINT}`);
    } catch {
      // Some errors end the transaction (ON CONFLICT ROLLBACK): then the savepoint is gone
    }
    throw error;
  }
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
      // Run the migration and record it as applied, in one savepoint
      atomically(db, migration.up, () => {
        execMultiple(db, migration.up);
        execute(
          db,
          "INSERT INTO _migrations (version, description) VALUES (?, ?)",
          [migration.version, migration.description]
        );
      });

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

  const down = migration.down;
  try {
    atomically(db, down, () => {
      execMultiple(db, down);
      execute(db, "DELETE FROM _migrations WHERE version = ?", [migration.version]);
    });
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
