/**
 * withConnection writes the file only when the database changed (deep dive DATA-13).
 */

import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, statSync, utimesSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, fileQueueKey, withConnection } from "./connect.js";
import { execute, query } from "./query.js";

const dirs: string[] = [];

afterEach(() => {
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "docker-sqlite-"));
  dirs.push(dir);
  return join(dir, "app.db");
}

async function seed(dbPath: string): Promise<void> {
  await withConnection({ dbPath }, (db) => {
    execute(db, "CREATE TABLE t (x INTEGER)");
    execute(db, "INSERT INTO t VALUES (1)");
  });
}

describe("withConnection", () => {
  it("does not write the file for a read", async () => {
    const dbPath = tempDb();
    await seed(dbPath);
    const past = new Date(Date.now() - 60_000);
    utimesSync(dbPath, past, past);
    const before = statSync(dbPath).mtimeMs;

    const rows = await withConnection({ dbPath }, (db) => query(db, "SELECT x FROM t").rows);

    expect(rows).toEqual([{ x: 1 }]);
    expect(statSync(dbPath).mtimeMs).toBe(before);
  });

  it("reads a read-only file", async () => {
    const dbPath = tempDb();
    await seed(dbPath);
    chmodSync(dbPath, 0o444);
    try {
      const rows = await withConnection({ dbPath }, (db) => query(db, "SELECT x FROM t").rows);
      expect(rows).toEqual([{ x: 1 }]);
    } finally {
      chmodSync(dbPath, 0o644);
    }
  });

  it("does not make a file for a query of a missing database", async () => {
    const dbPath = tempDb();

    await expect(withConnection({ dbPath }, (db) => query(db, "SELECT x FROM t"))).rejects.toThrow(/no such table/);
    expect(existsSync(dbPath)).toBe(false);

    // A query that succeeds does not make the file either
    const rows = await withConnection({ dbPath }, (db) => query(db, "SELECT 1 AS one").rows);
    expect(rows).toEqual([{ one: 1 }]);
    expect(existsSync(dbPath)).toBe(false);
  });

  it("writes the file after a change", async () => {
    const dbPath = tempDb();
    await seed(dbPath);
    await withConnection({ dbPath }, (db) => execute(db, "INSERT INTO t VALUES (2)"));

    const rows = await withConnection({ dbPath }, (db) => query(db, "SELECT x FROM t ORDER BY x").rows);
    expect(rows).toEqual([{ x: 1 }, { x: 2 }]);
  });

  it("does not lose a write that another connection made during a read", async () => {
    const dbPath = tempDb();
    await seed(dbPath);
    // A reader that holds an old copy, and a writer (another process) that adds a row meanwhile
    const reader = await createConnection({ dbPath });
    const writer = await createConnection({ dbPath });
    execute(writer.db, "INSERT INTO t VALUES (2)");
    await writer.save();
    writer.db.close();

    query(reader.db, "SELECT x FROM t");
    await reader.save();
    reader.db.close();

    const rows = await withConnection({ dbPath }, (db) => query(db, "SELECT x FROM t ORDER BY x").rows);
    expect(rows).toEqual([{ x: 1 }, { x: 2 }]);
    expect(readFileSync(dbPath).length).toBeGreaterThan(0);
  });
});

describe("fileQueueKey", () => {
  it("does not depend on case on Windows", () => {
    expect(fileQueueKey("C:\\Data\\App.db", "win32")).toBe(fileQueueKey("c:\\data\\app.db", "win32"));
  });

  it("keeps the case on other systems", () => {
    expect(fileQueueKey("/data/App.db", "linux")).not.toBe(fileQueueKey("/data/app.db", "linux"));
  });
});
