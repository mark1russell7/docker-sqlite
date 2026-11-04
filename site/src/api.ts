// The rows of the API table. Each function of the entry ./pure has a live example: the page calls the package with
// sql.js and shows the result. Each example gets a new database.
import {
  createMigration,
  execMultiple,
  execute,
  getMigrationStatus,
  lastInsertRowId,
  query,
  rollbackMigration,
  runMigrations,
  tableExists,
  type Database,
  type Migration,
} from "@mark1russell7/docker-sqlite/pure";
import type { SqlJsStatic } from "sql.js";
import { message } from "./demo.ts";

/** One example: the code, and the result of the code as text. */
export interface Example {
  readonly code: string;
  readonly run: (db: Database) => unknown;
}

/** One row of the table. */
export interface ApiRow {
  readonly names: readonly string[];
  readonly what: string;
  readonly examples: readonly Example[];
  /** The text for a row with no example in the browser. */
  readonly note?: string;
}

const migrations: Migration[] = [
  createMigration(1, "users", "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)", "DROP TABLE users"),
  createMigration(2, "email", "ALTER TABLE users ADD COLUMN email TEXT"),
];

const withUsers = (db: Database): Database => {
  execMultiple(db, "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT); INSERT INTO users (name) VALUES ('Ada'), ('Linus');");
  return db;
};

export const API: readonly ApiRow[] = [
  {
    names: ["query"],
    what: "Runs a SELECT with parameters, and gives the column names and the rows as objects.",
    examples: [
      { code: 'query(db, "SELECT 1 + 1 AS two")', run: (db) => query(db, "SELECT 1 + 1 AS two") },
      { code: 'query(db, "SELECT name FROM users WHERE id = ?", [2]).rows', run: (db) => query(withUsers(db), "SELECT name FROM users WHERE id = ?", [2]).rows },
    ],
  },
  {
    names: ["execute"],
    what: "Runs one INSERT, UPDATE or DELETE with parameters, and gives the number of changed rows.",
    examples: [{ code: 'execute(db, "UPDATE users SET name = upper(name)")', run: (db) => execute(withUsers(db), "UPDATE users SET name = upper(name)") }],
  },
  {
    names: ["execMultiple"],
    what: "Runs a script of statements with no parameters, for example a schema.",
    examples: [
      {
        code: 'execMultiple(db, "CREATE TABLE a (x); CREATE TABLE b (y)"); tableExists(db, "b")',
        run: (db) => {
          execMultiple(db, "CREATE TABLE a (x); CREATE TABLE b (y)");
          return tableExists(db, "b");
        },
      },
    ],
  },
  {
    names: ["lastInsertRowId"],
    what: "Gives the rowid of the last INSERT of the connection.",
    examples: [
      {
        code: "execute(db, \"INSERT INTO users (name) VALUES ('Grace')\"); lastInsertRowId(db)",
        run: (db) => {
          execute(withUsers(db), "INSERT INTO users (name) VALUES ('Grace')");
          return lastInsertRowId(db);
        },
      },
    ],
  },
  {
    names: ["tableExists"],
    what: "Tells if the database has a table with the name.",
    examples: [{ code: 'tableExists(db, "users")', run: (db) => tableExists(db, "users") }],
  },
  {
    names: ["createMigration"],
    what: "Makes a migration object from a version, a description, the up SQL and an optional down SQL.",
    examples: [{ code: 'createMigration(2, "email", "ALTER TABLE users ADD COLUMN email TEXT")', run: () => migrations[1] }],
  },
  {
    names: ["runMigrations"],
    what: "Applies each pending migration in a savepoint, in the sequence of the versions, and records it in _migrations.",
    examples: [{ code: "runMigrations(db, migrations).map((m) => m.version)", run: (db) => runMigrations(db, migrations).map((m) => m.version) }],
  },
  {
    names: ["getMigrationStatus"],
    what: "Gives the current version, the applied versions and the pending migrations.",
    examples: [
      {
        code: "runMigrations(db, migrations.slice(0, 1)); getMigrationStatus(db, migrations).currentVersion",
        run: (db) => {
          runMigrations(db, migrations.slice(0, 1));
          return getMigrationStatus(db, migrations).currentVersion;
        },
      },
    ],
  },
  {
    names: ["rollbackMigration"],
    what: "Runs the down SQL of the last applied migration, and removes its record.",
    examples: [
      {
        code: "runMigrations(db, migrations.slice(0, 1)); rollbackMigration(db, migrations)?.version",
        run: (db) => {
          runMigrations(db, migrations.slice(0, 1));
          return rollbackMigration(db, migrations)?.version;
        },
      },
    ],
  },
  {
    names: ["withConnection", "createConnection", "DatabaseFileChangedError"],
    what: "They load a database file, run your code and save the file in one atomic step. Each file gets one call at a time.",
    examples: [],
    note: "Node.js only: these functions read and write files. Import them from the main entry.",
  },
];

/** The result of an example on a new database, as text. */
export function result(sql: SqlJsStatic, example: Example): string {
  const db = new sql.Database();
  try {
    const value = example.run(db);
    return value === undefined ? "undefined" : JSON.stringify(value);
  } catch (error) {
    return `throws: ${message(error)}`;
  } finally {
    db.close();
  }
}
