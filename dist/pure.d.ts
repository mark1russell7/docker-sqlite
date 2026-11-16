/**
 * The functions of docker-sqlite with no file access: the query helpers and the migrations.
 *
 * Each function gets a sql.js `Database`. A browser bundle can import this entry,
 * `@mark1russell7/docker-sqlite/pure`. It does not import a `node:` module.
 *
 * This entry is deprecated since 0.3.3. Its home is `@mark1russell7/sqlite/portable`, which also imports no module of Node.js.
 */
export type { QueryResult, ExecuteResult, Migration, MigrationStatus, } from "./types.js";
export { query, execute, execMultiple, lastInsertRowId, tableExists, } from "./query.js";
export { getMigrationStatus, runMigrations, rollbackMigration, createMigration, } from "./migrate.js";
export type { Database } from "sql.js";
//# sourceMappingURL=pure.d.ts.map