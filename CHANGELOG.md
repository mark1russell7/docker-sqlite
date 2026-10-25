# Change history

## 0.2.0

### Breaking changes

- The `save` of `createConnection` does not write over a file that changed after the connection loaded it or saved it last. It throws a `DatabaseFileChangedError` and writes nothing. Before, it wrote the old copy of the connection with its change, and the changes of the other connection or process were lost. A program that keeps one connection open while another connection, another process or the web UI writes the same file now gets this error. To continue, close the connection, open a new one and make the change again.

### New

- `DatabaseFileChangedError`, with `code: "DATABASE_FILE_CHANGED"` and `dbPath`.

### Corrections

- The `save` of `createConnection` runs in the queue of the file, one call at a time with `withConnection` and the other saves of this process. Before, it ran outside the queue. In a `withConnection` callback for the same file, it runs at once, so it cannot wait for itself.

## 0.1.1

### Corrections

- `runMigrations` runs each migration and its record in a savepoint. Before, a migration that failed after its first statement kept the changes of those statements and had no record: the next run failed with "table already exists". `rollbackMigration` does the same for a `down` script.
- A migration whose SQL controls transactions itself (`BEGIN`, `COMMIT`, `VACUUM`, `PRAGMA` and some others) runs as before, without the savepoint. In a transaction, these statements fail or do nothing.
- `query` gives the column names also for a result with no rows. Before, `columns` was empty for such a result.
- A save flushes the temporary file to the disk before the rename, so a power loss cannot leave an empty or partial database.
- Each save has a temporary file with a random name. Before, the name had only the process id and the time in milliseconds, so two saves in one millisecond could write the same file.
- A save writes the database file directly only when the rename fails because Windows holds the file open (`EPERM`, `EACCES` or `EBUSY`). Before, each error of the rename started this direct write, which is not atomic.

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
