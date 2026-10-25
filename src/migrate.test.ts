/**
 * Each migration is atomic: a migration that fails leaves no part of its changes.
 */

import { beforeAll, describe, expect, it } from "vitest";
import initSqlJs, { type Database } from "sql.js";
import { getMigrationStatus, rollbackMigration, runMigrations } from "./migrate.js";
import { execute, query, tableExists } from "./query.js";
import type { Migration } from "./types.js";

let SQL: Awaited<ReturnType<typeof initSqlJs>>;

beforeAll(async () => {
  SQL = await initSqlJs();
});

function newDb(): Database {
  return new SQL.Database();
}

const createA: Migration = { version: 1, description: "a", up: "CREATE TABLE a (x INTEGER)", down: "DROP TABLE a" };

describe("runMigrations", () => {
  it("applies the migrations in order, and records them", () => {
    const db = newDb();
    const migrations: Migration[] = [
      { version: 2, description: "b", up: "CREATE TABLE b (y INTEGER); INSERT INTO b VALUES (1);" },
      createA,
    ];
    expect(runMigrations(db, migrations).map((m) => m.version)).toEqual([1, 2]);
    expect(getMigrationStatus(db, migrations).appliedMigrations).toEqual([1, 2]);
    expect(query(db, "SELECT y FROM b").rows).toEqual([{ y: 1 }]);
    expect(runMigrations(db, migrations)).toEqual([]);
  });

  it("keeps no part of a migration that fails", () => {
    const db = newDb();
    const migrations: Migration[] = [
      createA,
      { version: 2, description: "two tables", up: "CREATE TABLE b (y INTEGER); INSERT INTO b VALUES (1); CREATE TABLE c (bad" },
    ];

    expect(() => runMigrations(db, migrations)).toThrow(/Failed to apply migration 2 \(two tables\)/);
    // The migrations before the failure stay applied
    expect(tableExists(db, "a")).toBe(true);
    expect(tableExists(db, "b")).toBe(false);
    expect(getMigrationStatus(db, migrations).appliedMigrations).toEqual([1]);

    // A corrected migration applies on the next run. Before, "table b already exists" stopped it.
    migrations[1] = { version: 2, description: "two tables", up: "CREATE TABLE b (y INTEGER); CREATE TABLE c (z INTEGER);" };
    expect(runMigrations(db, migrations).map((m) => m.version)).toEqual([2]);
    expect(tableExists(db, "b") && tableExists(db, "c")).toBe(true);
  });

  it("joins a transaction of the caller, and keeps its changes when a migration fails", () => {
    const db = newDb();
    execute(db, "CREATE TABLE t (x INTEGER)");
    db.exec("BEGIN");
    execute(db, "INSERT INTO t VALUES (1)");
    expect(() =>
      runMigrations(db, [{ version: 1, description: "bad", up: "CREATE TABLE b (y INTEGER); CREATE TABLE c (bad" }])
    ).toThrow(/Failed to apply migration 1/);
    expect(tableExists(db, "b")).toBe(false);
    // The transaction of the caller is still open, with its row
    db.exec("COMMIT");
    expect(query(db, "SELECT x FROM t").rows).toEqual([{ x: 1 }]);

    db.exec("BEGIN");
    runMigrations(db, [createA]);
    db.exec("ROLLBACK");
    expect(tableExists(db, "a")).toBe(false);
  });

  it("runs a migration with its own transaction control as before", () => {
    const db = newDb();
    const migrations: Migration[] = [
      { version: 1, description: "own transaction", up: "BEGIN; CREATE TABLE a (x INTEGER); COMMIT;" },
      { version: 2, description: "pragma", up: "PRAGMA foreign_keys = ON; CREATE TABLE b (y INTEGER);" },
      { version: 3, description: "vacuum", up: "CREATE TABLE c (z INTEGER); VACUUM;" },
    ];
    expect(runMigrations(db, migrations).map((m) => m.version)).toEqual([1, 2, 3]);
    expect(query(db, "PRAGMA foreign_keys").rows).toEqual([{ foreign_keys: 1 }]);
    expect(tableExists(db, "a") && tableExists(db, "b") && tableExists(db, "c")).toBe(true);
  });

  it("keeps no part of a failed migration that makes a trigger", () => {
    const db = newDb();
    const up = `
      CREATE TABLE a (x INTEGER);
      CREATE TABLE log (x INTEGER);
      CREATE TRIGGER a_log AFTER INSERT ON a BEGIN
        INSERT INTO log VALUES (CASE WHEN new.x > 0 THEN new.x ELSE 0 END);
      END;
      CREATE TABLE c (bad`;
    expect(() => runMigrations(db, [{ version: 1, description: "trigger", up }])).toThrow(/Failed to apply migration 1/);
    expect(tableExists(db, "a")).toBe(false);
  });

  it("does not see transaction control in strings, quoted names and comments", () => {
    const db = newDb();
    const up = `
      -- BEGIN; a comment
      /* COMMIT; */
      CREATE TABLE "begin" (x TEXT DEFAULT 'x; COMMIT; y');
      CREATE TABLE c (bad`;
    expect(() => runMigrations(db, [{ version: 1, description: "quoted", up }])).toThrow(/Failed to apply migration 1/);
    expect(tableExists(db, "begin")).toBe(false);
  });
});

describe("rollbackMigration", () => {
  it("rolls back the last migration", () => {
    const db = newDb();
    runMigrations(db, [createA]);
    expect(rollbackMigration(db, [createA])?.version).toBe(1);
    expect(tableExists(db, "a")).toBe(false);
    expect(getMigrationStatus(db, [createA]).currentVersion).toBe(0);
  });

  it("keeps no part of a down migration that fails", () => {
    const db = newDb();
    const migration: Migration = {
      version: 1,
      description: "two tables",
      up: "CREATE TABLE a (x INTEGER); CREATE TABLE b (y INTEGER);",
      down: "DROP TABLE a; DROP TABLE missing;",
    };
    runMigrations(db, [migration]);
    expect(() => rollbackMigration(db, [migration])).toThrow(/Failed to rollback migration 1/);
    expect(tableExists(db, "a")).toBe(true);
    expect(getMigrationStatus(db, [migration]).currentVersion).toBe(1);
  });
});
