# Change history

## 0.1.0

The first version on npm. Before, projects installed the package from GitHub (`github:mark1russell7/docker-sqlite`).

`@mark1russell7/docker-sqlite` gives Node.js a SQLite database with no native build. It uses sql.js (SQLite compiled to WebAssembly) and adds safe access to database files, queries, migrations, and an optional Docker Compose file for a web UI (sqlite-web).

### Functions

- `withConnection` loads a database file, runs a callback and saves the file. `createConnection` gives a database and a `save` function.
- `query`, `execute` and the other query helpers, with parameters.
- Migrations: `runMigrations`, `getMigrationStatus`, `rollbackMigration` and `createMigration`.
- `docker-compose.yml` starts sqlite-web on `127.0.0.1:8080`.

### Corrections

- Calls for one file run one at a time in a process, and a save writes a temporary file and renames it. Before, 50 concurrent inserts into one file kept 1 row.
- A save happens only when the database changed. Before, each call wrote the file: a read failed on a read-only file, a read wrote an old copy over the rows of another process, and a query of a missing file made an empty file.
- `execute` runs every statement of SQL without parameters, and counts all changes. With parameters, several statements are an error. Before, sql.js ran only the first statement and the call reported success.
- On Windows, two spellings of one path (upper and lower case) share one queue.
- The web UI is published on `127.0.0.1` only, not on every network interface.
- The types of sql.js come from `@types/sql.js`, so the types of the package resolve for its users. Before, a local declaration in `src` was not part of the build.
