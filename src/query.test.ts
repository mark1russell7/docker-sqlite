/**
 * execute() with several statements (deep dive DATA-13). Before, sql.js ran only the first
 * statement when parameters were given, and the call reported success.
 */

import { describe, expect, it } from "vitest";
import { withConnection } from "./connect.js";
import { execute, hasSeveralStatements, query } from "./query.js";

describe("execute", () => {
  it("runs all statements when there are no parameters, and counts all changes", async () => {
    await withConnection({ dbPath: ":memory:" }, (db) => {
      execute(db, "CREATE TABLE t (x INTEGER)");
      const result = execute(db, "INSERT INTO t VALUES (1); INSERT INTO t VALUES (2);");

      expect(result.changes).toBe(2);
      expect(query(db, "SELECT x FROM t ORDER BY x").rows).toEqual([{ x: 1 }, { x: 2 }]);
    });
  });

  it("runs a script whose second statement uses the table of the first", async () => {
    await withConnection({ dbPath: ":memory:" }, (db) => {
      execute(db, "CREATE TABLE t (x INTEGER); INSERT INTO t VALUES (7)");

      expect(query(db, "SELECT x FROM t").rows).toEqual([{ x: 7 }]);
    });
  });

  it("rejects several statements with parameters, and runs none of them", async () => {
    await withConnection({ dbPath: ":memory:" }, (db) => {
      execute(db, "CREATE TABLE t (x INTEGER)");

      expect(() => execute(db, "INSERT INTO t VALUES (?); INSERT INTO t VALUES (9)", [5])).toThrow(/one statement/);
      expect(query(db, "SELECT x FROM t").rows).toEqual([]);
    });
  });

  it("binds parameters to one statement", async () => {
    await withConnection({ dbPath: ":memory:" }, (db) => {
      execute(db, "CREATE TABLE t (x INTEGER)");

      expect(execute(db, "INSERT INTO t VALUES (?);", [3]).changes).toBe(1);
      expect(query(db, "SELECT x FROM t").rows).toEqual([{ x: 3 }]);
    });
  });
});

describe("hasSeveralStatements", () => {
  it("ignores spaces, semicolons and comments after one statement", async () => {
    await withConnection({ dbPath: ":memory:" }, (db) => {
      expect(hasSeveralStatements(db, "SELECT 1;  -- done\n /* end */ ;")).toBe(false);
      expect(hasSeveralStatements(db, "SELECT ';'")).toBe(false);
      expect(hasSeveralStatements(db, "SELECT 1; SELECT 2")).toBe(true);
      expect(hasSeveralStatements(db, "")).toBe(false);
    });
  });
});
