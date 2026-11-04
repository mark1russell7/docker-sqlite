import { readFileSync } from "node:fs";
import initSqlJs, { type SqlJsStatic } from "sql.js";
import { beforeAll, describe, expect, it } from "vitest";
import { API, result } from "./api.ts";
import { callText, cellText, nextVersion, parseParams, PRESETS, Session, toMigrations } from "./demo.ts";

let SQL: SqlJsStatic;

beforeAll(async () => {
  SQL = await initSqlJs();
});

const preset = (id: string) => PRESETS.find((p) => p.id === id)!;

describe("the examples", () => {
  it("apply, except the migration that fails", () => {
    for (const p of PRESETS) {
      const session = new Session(SQL);
      const { migrations, problems } = toMigrations(p.migrations);
      expect(problems, p.id).toEqual([]);
      expect(session.migrate(migrations).ok, p.id).toBe(p.id !== "fails");
    }
  });

  it("have sample queries that run, except the level that the CHECK refuses", () => {
    for (const p of PRESETS) {
      if (p.id === "fails") continue;
      const session = new Session(SQL);
      session.migrate(toMigrations(p.migrations).migrations);
      for (const q of p.queries) {
        const parsed = parseParams(q.params);
        if (!parsed.ok) throw new Error(parsed.error);
        const outcome = session.run(q.mode, q.sql, parsed.params);
        expect(outcome.ok, `${p.id} ${q.id}`).toBe(q.id !== "bad-level");
      }
    }
  });

  it("use the logs schema that the package ships", () => {
    const shipped = readFileSync(new URL("../../schema/logs.sql", import.meta.url), "utf8");
    expect(preset("logs").migrations[0]!.up).toBe(shipped.trim());
  });
});

describe("the session", () => {
  it("records the SQL that runMigrations sends, in a savepoint", () => {
    const session = new Session(SQL);
    const outcome = session.migrate(toMigrations(preset("app").migrations).migrations);
    expect(outcome.ok && outcome.value.map((m) => m.version)).toEqual([1, 2, 3]);
    const sql = outcome.entry.trace.map((t) => t.sql.trim());
    expect(sql.filter((s) => s === "SAVEPOINT docker_sqlite_migration")).toHaveLength(3);
    expect(sql.filter((s) => s === "RELEASE docker_sqlite_migration")).toHaveLength(3);
    const records = outcome.entry.trace.filter((t) => t.sql.startsWith("INSERT INTO _migrations"));
    expect(records.map((t) => t.params[0])).toEqual([1, 2, 3]);
    expect(session.tables()).toEqual([
      { name: "_migrations", rows: 3 },
      { name: "posts", rows: 3 },
      { name: "users", rows: 2 },
    ]);
  });

  it("keeps no part of a failed migration", () => {
    const session = new Session(SQL);
    const migrations = toMigrations(preset("fails").migrations).migrations;
    const outcome = session.migrate(migrations);
    expect(outcome.ok).toBe(false);
    expect(outcome.entry.summary).toMatch(/^Failed to apply migration 2 .*missing_table/);
    expect(outcome.entry.trace.some((t) => t.sql.trim() === "ROLLBACK TO docker_sqlite_migration")).toBe(true);
    expect(session.tables().map((t) => t.name)).toEqual(["_migrations", "users"]);
    expect(session.status(migrations).appliedMigrations).toEqual([1]);
  });

  it("records the parameters of query and execute", () => {
    const session = new Session(SQL);
    session.migrate(toMigrations(preset("app").migrations).migrations);
    const read = session.run("query", "SELECT name FROM users WHERE id = ?", [2]);
    expect(read.ok && read.value).toEqual({ mode: "query", result: { columns: ["name"], rows: [{ name: "Linus" }] } });
    expect(read.entry.trace).toEqual([{ method: "prepare", sql: "SELECT name FROM users WHERE id = ?", params: [2] }]);
    const write = session.run("execute", "UPDATE users SET name = ? WHERE id = ?", ["Ada L.", 1]);
    expect(write.ok && write.value).toEqual({ mode: "execute", result: { changes: 1 } });
    expect(write.entry.call).toBe('execute(db, "UPDATE users SET name = ? WHERE id = ?", ["Ada L.", 1])');
  });

  it("rolls back the last migration, and a reset gives an empty database", () => {
    const session = new Session(SQL);
    const migrations = toMigrations(preset("app").migrations).migrations;
    session.migrate(migrations);
    const back = session.rollback(migrations);
    expect(back.ok && back.value?.version).toBe(3);
    expect(session.status(migrations).currentVersion).toBe(2);
    session.reset();
    expect(session.tables()).toEqual([]);
    expect(session.status(migrations).pendingMigrations).toHaveLength(3);
    expect(session.tables()).toEqual([]);
    expect(session.export().length).toBeGreaterThanOrEqual(0);
  });
});

describe("the input checks", () => {
  it("read the parameters as a JSON array", () => {
    expect(parseParams("")).toEqual({ ok: true, params: [] });
    expect(parseParams('["a", 1, null]')).toEqual({ ok: true, params: ["a", 1, null] });
    expect(parseParams("{}").ok).toBe(false);
    expect(parseParams("[true]").ok).toBe(false);
    expect(parseParams("not json").ok).toBe(false);
  });

  it("find the problems of the migrations", () => {
    const base = { description: "", down: "" };
    expect(toMigrations([{ ...base, version: 1, up: "SELECT 1" }, { ...base, version: 1, up: "" }]).problems).toEqual([
      "Two migrations have the version 1.",
      "The migration 1 has no up SQL.",
    ]);
    expect(toMigrations([{ ...base, version: 0, up: "SELECT 1" }]).problems).toHaveLength(1);
    expect(toMigrations([{ ...base, version: 4, up: "SELECT 1" }]).migrations[0]).toEqual({ version: 4, description: "Migration 4", up: "SELECT 1" });
    expect(nextVersion([{ ...base, version: 4, up: "" }, { ...base, version: 2, up: "" }])).toBe(5);
  });

  it("write cells and calls as text", () => {
    expect(cellText(null)).toBe("NULL");
    expect(cellText(new Uint8Array([1, 255]))).toBe("x'01ff'");
    expect(callText("query", "SELECT 1", [])).toBe('query(db, "SELECT 1")');
    expect(callText("query", "SELECT 1\nFROM t", [])).toBe("query(db, sql)");
  });
});

describe("the API table", () => {
  it("has a result for each example, and no error", () => {
    const outputs = API.flatMap((row) => row.examples.map((example) => result(SQL, example)));
    expect(outputs).toHaveLength(10);
    for (const output of outputs) expect(output).not.toMatch(/^throws/);
    expect(outputs[0]).toBe('{"columns":["two"],"rows":[{"two":2}]}');
  });
});
