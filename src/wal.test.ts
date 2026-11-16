/**
 * A file in WAL mode whose WAL file has data: sql.js reads only the main file, so the package
 * refuses it. Before 0.3.2, a read missed the rows of the WAL file, and a write was lost with no
 * error at the next checkpoint of the other connection.
 */

import { afterEach, describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createConnection, WalFileInUseError, withConnection } from "./connect.js";
import { execute, query } from "./query.js";

/** The part of a `node:sqlite` connection that the tests use. */
interface NodeDatabase {
  exec(sql: string): void;
  prepare(sql: string): { all(): unknown[] };
  close(): void;
}
type NodeDatabaseClass = new (path: string, options?: { readOnly?: boolean }) => NodeDatabase;

/**
 * The connection class of `node:sqlite`, or null when this Node.js has no `node:sqlite` without a
 * flag (before 22.13). Node.js 26.11 renamed `DatabaseSync` to `Database` (DEP0210).
 */
async function loadNodeSqlite(): Promise<NodeDatabaseClass | null> {
  try {
    const sqlite = (await import("node:sqlite")) as unknown as Record<string, NodeDatabaseClass | undefined>;
    return sqlite.Database ?? sqlite.DatabaseSync ?? null;
  } catch {
    return null;
  }
}

const NodeDatabase = await loadNodeSqlite();

const dirs: string[] = [];
const open: NodeDatabase[] = [];

afterEach(() => {
  for (const db of open.splice(0)) {
    db.close();
  }
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "docker-sqlite-wal-"));
  dirs.push(dir);
  return join(dir, "app.db");
}

function connect(path: string): NodeDatabase {
  if (NodeDatabase === null) {
    throw new Error("node:sqlite is not available");
  }
  const db = new NodeDatabase(path);
  open.push(db);
  return db;
}

function close(db: NodeDatabase): void {
  open.splice(open.indexOf(db), 1);
  db.close();
}

function values(db: NodeDatabase): string[] {
  return (db.prepare("SELECT x FROM t ORDER BY rowid").all() as { x: string }[]).map((row) => row.x);
}

/**
 * A writer in WAL mode that holds the file open. One row is in the main file, and one row is
 * only in the WAL file.
 */
function liveWalWriter(path: string): NodeDatabase {
  const writer = connect(path);
  writer.exec("PRAGMA journal_mode = WAL; PRAGMA wal_autocheckpoint = 0; CREATE TABLE t (x TEXT)");
  writer.exec("INSERT INTO t VALUES ('in-main')");
  writer.exec("PRAGMA wal_checkpoint(TRUNCATE)");
  writer.exec("INSERT INTO t VALUES ('only-in-wal')");
  expect(statSync(`${path}-wal`).size).toBeGreaterThan(0);
  return writer;
}

describe.skipIf(NodeDatabase === null)("a file in WAL mode", () => {
  it("refuses a read when another connection has rows in the WAL file", async () => {
    const path = tempDb();
    liveWalWriter(path);

    const read = withConnection({ dbPath: path }, (db) => query(db, "SELECT x FROM t").rows);

    await expect(read).rejects.toBeInstanceOf(WalFileInUseError);
    await expect(read).rejects.toMatchObject({ code: "WAL_FILE_IN_USE", dbPath: path });
  });

  it("refuses a write, and the rows of the other connection stay", async () => {
    const path = tempDb();
    const writer = liveWalWriter(path);

    const write = withConnection({ dbPath: path }, (db) => {
      execute(db, "INSERT INTO t VALUES ('from-sqljs')");
    });

    await expect(write).rejects.toBeInstanceOf(WalFileInUseError);
    expect(values(writer)).toEqual(["in-main", "only-in-wal"]);
    expect((writer.prepare("PRAGMA integrity_check").all() as { integrity_check: string }[])[0]?.integrity_check).toBe("ok");
  });

  it("refuses createConnection when the WAL file has data", async () => {
    const path = tempDb();
    liveWalWriter(path);

    await expect(createConnection({ dbPath: path })).rejects.toBeInstanceOf(WalFileInUseError);
  });

  it("refuses a save when a connection writes into the WAL file after the load", async () => {
    const path = tempDb();
    const setup = connect(path);
    setup.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('first')");
    close(setup);
    expect(existsSync(`${path}-wal`)).toBe(false);

    const { db, save } = await createConnection({ dbPath: path });
    try {
      const writer = connect(path);
      writer.exec("PRAGMA wal_autocheckpoint = 0; INSERT INTO t VALUES ('from-writer')");
      execute(db, "INSERT INTO t VALUES ('from-sqljs')");

      await expect(save()).rejects.toBeInstanceOf(WalFileInUseError);
      expect(values(writer)).toEqual(["first", "from-writer"]);
    } finally {
      db.close();
    }
  });

  it("names the path and the next step in the message", async () => {
    const path = tempDb();
    liveWalWriter(path);

    await expect(withConnection({ dbPath: path }, () => undefined)).rejects.toThrow(
      /WAL mode.*@procedures\/sqlite on Node\.js 22\.13 or later.*wal_checkpoint\(TRUNCATE\)/s
    );
    await expect(withConnection({ dbPath: path }, () => undefined)).rejects.toThrow(path);
  });

  it("reads and writes a WAL file that SQLite closed cleanly (no WAL file)", async () => {
    const path = tempDb();
    const setup = connect(path);
    setup.exec("PRAGMA journal_mode = WAL; CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('a'), ('b')");
    close(setup);
    expect(existsSync(`${path}-wal`)).toBe(false);

    const rows = await withConnection({ dbPath: path }, (db) => query<{ x: string }>(db, "SELECT x FROM t ORDER BY rowid").rows);
    expect(rows.map((row) => row.x)).toEqual(["a", "b"]);

    await withConnection({ dbPath: path }, (db) => {
      execute(db, "INSERT INTO t VALUES ('c')");
    });
    const after = connect(path);
    expect(values(after)).toEqual(["a", "b", "c"]);
  });

  it("reads and writes a file in rollback-journal mode as before", async () => {
    const path = tempDb();
    const setup = connect(path);
    setup.exec("PRAGMA journal_mode = DELETE; CREATE TABLE t (x TEXT); INSERT INTO t VALUES ('a')");
    close(setup);

    await withConnection({ dbPath: path }, (db) => {
      execute(db, "INSERT INTO t VALUES ('b')");
    });
    const { db, save } = await createConnection({ dbPath: path });
    try {
      execute(db, "INSERT INTO t VALUES ('c')");
      await save();
    } finally {
      db.close();
    }
    const after = connect(path);
    expect(values(after)).toEqual(["a", "b", "c"]);
  });
});
