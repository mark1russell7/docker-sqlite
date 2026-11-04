// The logic of the playground, with no DOM: the examples, the input checks and one session with a database.
// The session calls the functions of the package, and records each SQL text that they send to SQLite.
import {
  createMigration,
  execute,
  getMigrationStatus,
  query,
  rollbackMigration,
  runMigrations,
  tableExists,
  type Database,
  type ExecuteResult,
  type Migration,
  type MigrationStatus,
  type QueryResult,
} from "@mark1russell7/docker-sqlite/pure";
import type { BindParams, SqlJsStatic, SqlValue, Statement } from "sql.js";
import LOGS_SQL from "../../schema/logs.sql?raw";

/** A migration as the visitor edits it. An empty `down` is no down migration. */
export interface MigrationDraft {
  readonly version: number;
  readonly description: string;
  readonly up: string;
  readonly down: string;
}

/** The two functions that run the SQL of the query box. */
export type QueryMode = "query" | "execute";

/** A sample query of an example. */
export interface SampleQuery {
  readonly id: string;
  readonly label: string;
  readonly mode: QueryMode;
  readonly sql: string;
  /** The parameters as a JSON array. */
  readonly params: string;
}

/** An example: its migrations and its sample queries. */
export interface Preset {
  readonly id: string;
  readonly label: string;
  readonly migrations: readonly MigrationDraft[];
  readonly queries: readonly SampleQuery[];
}

const USERS: MigrationDraft = {
  version: 1,
  description: "Create the users table",
  up: "CREATE TABLE users (\n  id INTEGER PRIMARY KEY,\n  name TEXT NOT NULL\n);",
  down: "DROP TABLE users;",
};

const MIGRATIONS_TABLE: SampleQuery = {
  id: "migrations",
  label: "The _migrations table",
  mode: "query",
  sql: "SELECT * FROM _migrations ORDER BY version",
  params: "[]",
};

export const PRESETS: readonly Preset[] = [
  {
    id: "app",
    label: "Users and posts",
    migrations: [
      USERS,
      {
        version: 2,
        description: "Add an email column and two users",
        up: "ALTER TABLE users ADD COLUMN email TEXT;\nINSERT INTO users (name, email) VALUES\n  ('Ada', 'ada@example.com'),\n  ('Linus', 'linus@example.com');",
        down: "DELETE FROM users;\nALTER TABLE users DROP COLUMN email;",
      },
      {
        version: 3,
        description: "Create the posts table",
        up: "CREATE TABLE posts (\n  id INTEGER PRIMARY KEY,\n  user_id INTEGER NOT NULL REFERENCES users(id),\n  title TEXT NOT NULL\n);\nINSERT INTO posts (user_id, title) VALUES\n  (1, 'Notes on the engine'),\n  (1, 'A second note'),\n  (2, 'Hello');",
        down: "DROP TABLE posts;",
      },
    ],
    queries: [
      { id: "users", label: "All users", mode: "query", sql: "SELECT * FROM users ORDER BY id", params: "[]" },
      { id: "by-name", label: "A user by name", mode: "query", sql: "SELECT id, name, email FROM users WHERE name = ?", params: '["Ada"]' },
      { id: "insert", label: "Insert a user", mode: "execute", sql: "INSERT INTO users (name, email) VALUES (?, ?)", params: '["Grace", "grace@example.com"]' },
      {
        id: "join",
        label: "Posts per user",
        mode: "query",
        sql: "SELECT u.name, COUNT(p.id) AS posts\nFROM users u LEFT JOIN posts p ON p.user_id = u.id\nGROUP BY u.id\nORDER BY posts DESC, u.name",
        params: "[]",
      },
      MIGRATIONS_TABLE,
    ],
  },
  {
    id: "fails",
    label: "A migration that fails",
    migrations: [
      USERS,
      {
        version: 2,
        description: "Create tags, then insert into a missing table",
        up: "CREATE TABLE tags (name TEXT NOT NULL);\nINSERT INTO tags (name) VALUES ('sqlite');\nINSERT INTO missing_table VALUES (1);",
        down: "DROP TABLE tags;",
      },
    ],
    queries: [
      { id: "tables", label: "The tables", mode: "query", sql: "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name", params: "[]" },
      MIGRATIONS_TABLE,
    ],
  },
  {
    id: "logs",
    label: "The logs schema of the package",
    migrations: [
      { version: 1, description: "Create the logs table of schema/logs.sql", up: LOGS_SQL.trim(), down: "DROP TABLE logs;" },
      {
        version: 2,
        description: "Add three log rows",
        up: "INSERT INTO logs (level, message, session_id, command) VALUES\n  ('info', 'Start', 's1', 'lib.refresh'),\n  ('warn', 'Slow install', 's1', 'lib.refresh'),\n  ('error', 'Build failed', 's2', 'lib.build');",
        down: "DELETE FROM logs;",
      },
    ],
    queries: [
      {
        id: "problems",
        label: "Warnings and errors",
        mode: "query",
        sql: "SELECT level, message, command FROM logs\nWHERE level IN (?, ?)\nORDER BY id",
        params: '["warn", "error"]',
      },
      { id: "sessions", label: "Rows per session", mode: "query", sql: "SELECT session_id, COUNT(*) AS n FROM logs GROUP BY session_id ORDER BY session_id", params: "[]" },
      { id: "bad-level", label: "A level that the CHECK refuses", mode: "execute", sql: "INSERT INTO logs (level, message) VALUES (?, ?)", params: '["fatal", "Disk full"]' },
      MIGRATIONS_TABLE,
    ],
  },
];

/** The migrations of the drafts, with `createMigration` of the package, or the problems of the drafts. */
export function toMigrations(drafts: readonly MigrationDraft[]): { readonly migrations: Migration[]; readonly problems: string[] } {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const draft of drafts) {
    if (!Number.isSafeInteger(draft.version) || draft.version < 1) problems.push(`The version ${draft.version} is not a whole number of 1 or more.`);
    else if (seen.has(draft.version)) problems.push(`Two migrations have the version ${draft.version}.`);
    seen.add(draft.version);
    if (draft.up.trim() === "") problems.push(`The migration ${draft.version} has no up SQL.`);
  }
  const migrations = drafts.map((d) => createMigration(d.version, d.description.trim() || `Migration ${d.version}`, d.up, d.down.trim() === "" ? undefined : d.down));
  return { migrations, problems };
}

/** The parameters of the query box: a JSON array of strings, numbers and nulls. An empty box is no parameter. */
export function parseParams(text: string): { readonly ok: true; readonly params: (string | number | null)[] } | { readonly ok: false; readonly error: string } {
  if (text.trim() === "") return { ok: true, params: [] };
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    return { ok: false, error: 'The parameters are not JSON. Write an array, for example ["Ada", 1].' };
  }
  if (!Array.isArray(value)) return { ok: false, error: 'The parameters are not an array. Write an array, for example ["Ada", 1].' };
  for (const item of value) {
    if (item !== null && typeof item !== "string" && !(typeof item === "number" && Number.isFinite(item))) {
      return { ok: false, error: `The parameter ${JSON.stringify(item)} is not a string, a number or null.` };
    }
  }
  return { ok: true, params: value as (string | number | null)[] };
}

/** One SQL text that the package sent to sql.js, with its parameters. */
export interface TraceEntry {
  readonly method: "exec" | "run" | "prepare";
  readonly sql: string;
  readonly params: readonly unknown[];
}

/** The methods of a sql.js `Database` that run SQL. `iterateStatements` only prepares, so the trace skips it. */
const TRACED = new Set(["exec", "run", "prepare"]);

/**
 * A database that records each SQL text of `exec`, `run` and `prepare` in `sink`, and then calls sql.js.
 * The package gets this database, so the trace shows the SQL that the package sends.
 */
export function traced(db: Database, sink: TraceEntry[]): Database {
  return new Proxy(db, {
    get(target, property) {
      const value: unknown = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      const fn = value as (...args: unknown[]) => unknown;
      if (typeof property === "string" && TRACED.has(property)) {
        return (...args: unknown[]) => {
          const entry: { method: TraceEntry["method"]; sql: string; params: readonly unknown[] } = {
            method: property as TraceEntry["method"],
            sql: String(args[0]),
            params: Array.isArray(args[1]) ? (args[1] as unknown[]) : [],
          };
          sink.push(entry);
          const result = fn.apply(target, args);
          if (property === "prepare") {
            // `query` binds the parameters to the statement after the prepare: the entry gets them from the bind.
            const statement = result as Statement;
            const bind = statement.bind.bind(statement);
            statement.bind = (values?: BindParams) => {
              if (Array.isArray(values)) entry.params = [...values];
              return bind(values);
            };
          }
          return result;
        };
      }
      return fn.bind(target);
    },
  });
}

/** One call of the log: the call as code, its result in words, and the SQL that it sent. */
export interface LogEntry {
  readonly id: number;
  readonly call: string;
  readonly ok: boolean;
  readonly summary: string;
  readonly trace: readonly TraceEntry[];
  readonly ms: number;
}

/** The result of a call of the session: the value or the error, and the log entry. */
export type Outcome<T> = ({ readonly ok: true; readonly value: T } | { readonly ok: false; readonly error: string }) & { readonly entry: LogEntry };

/** The result of the query box. */
export type RunResult = { readonly mode: "query"; readonly result: QueryResult } | { readonly mode: "execute"; readonly result: ExecuteResult };

/** A table of the database, with its number of rows. */
export interface TableInfo {
  readonly name: string;
  readonly rows: number;
}

const now = (): number => (typeof performance === "undefined" ? Date.now() : performance.now());

/** The text of an error. */
export function message(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The text of one parameter in the code of a call. */
const literal = (value: unknown): string => JSON.stringify(value) ?? String(value);

/** The call of the query box as code, for the log. */
export function callText(mode: QueryMode, sql: string, params: readonly unknown[]): string {
  const sqlText = sql.includes("\n") || sql.length > 60 ? "sql" : literal(sql);
  return params.length === 0 ? `${mode}(db, ${sqlText})` : `${mode}(db, ${sqlText}, [${params.map(literal).join(", ")}])`;
}

/**
 * One database in memory, and the log of the calls. Each call goes to a function of the package, with a database that
 * records its SQL. The reads of the page (the tables and the migration status) use the database with no record.
 */
export class Session {
  readonly #sql: SqlJsStatic;
  #raw: Database;
  #db: Database;
  #trace: TraceEntry[] = [];
  #next = 1;
  /** The calls, the newest last. */
  readonly log: LogEntry[] = [];

  constructor(sql: SqlJsStatic) {
    this.#sql = sql;
    this.#raw = new sql.Database();
    this.#db = traced(this.#raw, this.#trace);
  }

  /** A new empty database. The log stays, with one entry for the reset. */
  reset(): void {
    this.#raw.close();
    this.#raw = new this.#sql.Database();
    this.#trace.length = 0;
    this.#db = traced(this.#raw, this.#trace);
    this.log.push({ id: this.#next++, call: "new SQL.Database()", ok: true, summary: "A new empty database in memory.", trace: [], ms: 0 });
  }

  #record<T>(call: string, fn: (db: Database) => T, summarize: (value: T) => string): Outcome<T> {
    this.#trace.length = 0;
    const start = now();
    let outcome: { ok: true; value: T } | { ok: false; error: string };
    try {
      outcome = { ok: true, value: fn(this.#db) };
    } catch (error) {
      outcome = { ok: false, error: message(error) };
    }
    const entry: LogEntry = {
      id: this.#next++,
      call,
      ok: outcome.ok,
      summary: outcome.ok ? summarize(outcome.value) : outcome.error,
      trace: [...this.#trace],
      ms: now() - start,
    };
    this.log.push(entry);
    return { ...outcome, entry };
  }

  /** `runMigrations` of the package, with the migrations of the drafts. */
  migrate(migrations: Migration[]): Outcome<Migration[]> {
    return this.#record(
      "runMigrations(db, migrations)",
      (db) => runMigrations(db, migrations),
      (applied) => (applied.length === 0 ? "No migration is pending." : `Applied ${applied.length}: ${applied.map((m) => `v${m.version}`).join(", ")}.`),
    );
  }

  /** `rollbackMigration` of the package. */
  rollback(migrations: Migration[]): Outcome<Migration | null> {
    return this.#record(
      "rollbackMigration(db, migrations)",
      (db) => rollbackMigration(db, migrations),
      (migration) => (migration === null ? "No migration is applied." : `Rolled back v${migration.version}: ${migration.description}.`),
    );
  }

  /** `query` or `execute` of the package. */
  run(mode: QueryMode, sql: string, params: (string | number | null)[]): Outcome<RunResult> {
    return this.#record(
      callText(mode, sql, params),
      (db): RunResult => (mode === "query" ? { mode, result: query(db, sql, params) } : { mode, result: execute(db, sql, params) }),
      (run) => (run.mode === "query" ? `${run.result.rows.length} ${run.result.rows.length === 1 ? "row" : "rows"}.` : `${run.result.changes} ${run.result.changes === 1 ? "row" : "rows"} changed.`),
    );
  }

  /**
   * `getMigrationStatus` of the package, with no record. That function makes the table `_migrations`. Thus a database
   * with no such table gets the status of no applied migration, and stays empty.
   */
  status(migrations: Migration[]): MigrationStatus {
    if (tableExists(this.#raw, "_migrations")) return getMigrationStatus(this.#raw, migrations);
    return { currentVersion: 0, appliedMigrations: [], pendingMigrations: [...migrations].sort((a, b) => a.version - b.version) };
  }

  /** `query` of the package, with no record: the reads of the page. */
  peek(sql: string): QueryResult {
    return query(this.#raw, sql);
  }

  /** The tables of the database and their numbers of rows, with no record. */
  tables(): TableInfo[] {
    const names = query<{ name: string }>(this.#raw, "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name").rows.map((r) => r.name);
    return names.map((name) => ({ name, rows: Number(query<{ n: number }>(this.#raw, `SELECT COUNT(*) AS n FROM "${name.replaceAll('"', '""')}"`).rows[0]?.n ?? 0) }));
  }

  /** The bytes of the database file. */
  export(): Uint8Array {
    return this.#raw.export();
  }
}

/** The text of a cell of a result. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (value instanceof Uint8Array) return `x'${[...value].map((b) => b.toString(16).padStart(2, "0")).join("")}'`;
  return String(value as SqlValue);
}

/** The version of a new migration after the drafts: one more than the highest version. */
export function nextVersion(drafts: readonly MigrationDraft[]): number {
  return drafts.reduce((max, d) => (Number.isFinite(d.version) && d.version > max ? d.version : max), 0) + 1;
}
