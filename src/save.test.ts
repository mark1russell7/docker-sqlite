/**
 * The atomic save: a temporary file with a random name, and a direct write only when Windows
 * holds the file open.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";

/** The error code of the next rename, or null for a rename that works. */
const renameFailure = vi.hoisted(() => ({ code: null as string | null }));

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {
    ...actual,
    rename: async (from: string, to: string) => {
      const code = renameFailure.code;
      if (code) {
        renameFailure.code = null;
        throw Object.assign(new Error(`${code}: rename`), { code });
      }
      return actual.rename(from, to);
    },
  };
});

const { withConnection } = await import("./connect.js");
const { execute, query } = await import("./query.js");

const dirs: string[] = [];

afterEach(() => {
  renameFailure.code = null;
  for (const dir of dirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "docker-sqlite-save-"));
  dirs.push(dir);
  return join(dir, "app.db");
}

async function rowsOf(dbPath: string): Promise<unknown[]> {
  return withConnection({ dbPath }, (db) => query(db, "SELECT x FROM t ORDER BY x").rows);
}

function filesNextTo(dbPath: string): string[] {
  return readdirSync(dirname(dbPath)).filter((name) => name !== basename(dbPath));
}

describe("the save of a database file", () => {
  it("leaves no temporary file", async () => {
    const dbPath = tempDb();
    await withConnection({ dbPath }, (db) => execute(db, "CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (1);"));

    expect(await rowsOf(dbPath)).toEqual([{ x: 1 }]);
    expect(filesNextTo(dbPath)).toEqual([]);
  });

  it("writes the file directly when Windows holds it open", async () => {
    const dbPath = tempDb();
    await withConnection({ dbPath }, (db) => execute(db, "CREATE TABLE t (x INTEGER)"));

    renameFailure.code = "EPERM";
    await withConnection({ dbPath }, (db) => execute(db, "INSERT INTO t VALUES (1)"));

    expect(renameFailure.code).toBeNull();
    expect(await rowsOf(dbPath)).toEqual([{ x: 1 }]);
    expect(filesNextTo(dbPath)).toEqual([]);
  });

  it("does not write the file directly after another error of the rename", async () => {
    const dbPath = tempDb();
    await withConnection({ dbPath }, (db) => execute(db, "CREATE TABLE t (x INTEGER)"));

    renameFailure.code = "ENOENT";
    await expect(withConnection({ dbPath }, (db) => execute(db, "INSERT INTO t VALUES (1)"))).rejects.toThrow(/ENOENT/);

    expect(await rowsOf(dbPath)).toEqual([]);
    expect(filesNextTo(dbPath)).toEqual([]);
  });
});
