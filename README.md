# @mark1russell7/docker-sqlite

Reusable SQLite setup with TypeScript utilities. Uses sql.js (SQLite compiled to WASM) for portable database operations.

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              Application                                     │
│                                                                              │
│   await withConnection({ dbPath: './app.db' }, async (db) => {              │
│     execute(db, 'INSERT INTO users (name) VALUES (?)', ['Alice']);          │
│     const { rows } = query(db, 'SELECT * FROM users');                      │
│   });                                                                        │
│                              │                                               │
└──────────────────────────────┼───────────────────────────────────────────────┘
                               ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                           docker-sqlite                                      │
├─────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        Connection (connect.ts)                          │ │
│  │                                                                         │ │
│  │   withConnection(config, callback)                                     │ │
│  │   ├── Load db file (or create in-memory)                              │ │
│  │   ├── Execute callback with db instance                               │ │
│  │   └── Auto-save and close on completion                               │ │
│  │                                                                         │ │
│  │   createConnection(config)                                             │ │
│  │   └── Manual connection management                                     │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                          Query (query.ts)                               │ │
│  │                                                                         │ │
│  │   query(db, sql, params?)                                              │ │
│  │   └── Execute SELECT, return { rows, columns }                        │ │
│  │                                                                         │ │
│  │   execute(db, sql, params?)                                            │ │
│  │   └── Execute INSERT/UPDATE/DELETE, return { changes }                │ │
│  │                                                                         │ │
│  │   execMultiple(db, statements)                                         │ │
│  │   └── Execute multiple statements (migrations, setup)                 │ │
│  │                                                                         │ │
│  │   tableExists(db, tableName)                                           │ │
│  │   └── Check if table exists                                           │ │
│  │                                                                         │ │
│  │   lastInsertRowId(db)                                                  │ │
│  │   └── Get last inserted row ID                                        │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
│  ┌────────────────────────────────────────────────────────────────────────┐ │
│  │                        Migration (migrate.ts)                           │ │
│  │                                                                         │ │
│  │   runMigrations(db, migrations)                                        │ │
│  │   └── Apply pending migrations in order                               │ │
│  │                                                                         │ │
│  │   rollbackMigration(db, migrations, version)                           │ │
│  │   └── Rollback to specific version                                    │ │
│  │                                                                         │ │
│  │   getMigrationStatus(db)                                               │ │
│  │   └── Get current migration version                                   │ │
│  │                                                                         │ │
│  │   createMigration({ version, description, up, down })                  │ │
│  │   └── Helper to create migration objects                              │ │
│  └────────────────────────────────────────────────────────────────────────┘ │
│                                                                              │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
                          ┌─────────────────────┐
                          │       sql.js        │
                          │   (SQLite in WASM)  │
                          └─────────────────────┘
```

## Installation

```bash
npm install github:mark1russell7/docker-sqlite#main
```

## Quick Start

```typescript
import { withConnection, query, execute, runMigrations } from "@mark1russell7/docker-sqlite";

// Define migrations
const migrations = [
  {
    version: 1,
    description: "Create users table",
    up: "CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT, email TEXT)",
    down: "DROP TABLE users",
  },
];

// Run with managed connection (auto-saves)
await withConnection({ dbPath: "./data/app.db" }, (db) => {
  // Run migrations
  runMigrations(db, migrations);

  // Insert data
  execute(db, "INSERT INTO users (name, email) VALUES (?, ?)", ["Alice", "alice@example.com"]);

  // Query data
  const result = query(db, "SELECT * FROM users");
  console.log(result.rows);
});
```

## API Reference

### Connection

```typescript
// Managed connection (recommended)
async function withConnection<T>(
  config: ConnectionConfig,
  callback: ConnectionCallback<T>
): Promise<T>;

// Manual connection (caller must save/close)
async function createConnection(config: ConnectionConfig): Promise<{
  db: Database;
  save: () => void;
  close: () => void;
}>;

interface ConnectionConfig {
  dbPath?: string;  // File path (default: in-memory)
}
```

### Query

```typescript
function query(db: Database, sql: string, params?: unknown[]): QueryResult;
function execute(db: Database, sql: string, params?: unknown[]): ExecuteResult;
function execMultiple(db: Database, statements: string[]): void;
function tableExists(db: Database, tableName: string): boolean;
function lastInsertRowId(db: Database): number;

interface QueryResult {
  rows: Record<string, unknown>[];
  columns: string[];
}

interface ExecuteResult {
  changes: number;
}
```

### Migration

```typescript
function runMigrations(db: Database, migrations: Migration[]): MigrationStatus;
function rollbackMigration(db: Database, migrations: Migration[], toVersion: number): void;
function getMigrationStatus(db: Database): MigrationStatus;
function createMigration(config: MigrationConfig): Migration;

interface Migration {
  version: number;
  description: string;
  up: string;
  down: string;
}

interface MigrationStatus {
  currentVersion: number;
  appliedMigrations: number[];
}
```

## Examples

### In-Memory Database

```typescript
await withConnection({}, (db) => {
  execute(db, "CREATE TABLE temp (id INTEGER, data TEXT)");
  execute(db, "INSERT INTO temp VALUES (1, 'test')");
  const { rows } = query(db, "SELECT * FROM temp");
  // Database is discarded after callback
});
```

### Persistent Database

```typescript
await withConnection({ dbPath: "./data/myapp.db" }, (db) => {
  // Changes are automatically saved when callback completes
  execute(db, "INSERT INTO logs (msg) VALUES (?)", ["Hello"]);
});
```

### Manual Connection

```typescript
const { db, save, close } = await createConnection({ dbPath: "./data/myapp.db" });

try {
  execute(db, "INSERT INTO logs (msg) VALUES (?)", ["Hello"]);
  save();  // Explicitly save
} finally {
  close();  // Always close
}
```

### Multiple Statements

```typescript
await withConnection({ dbPath: "./data/app.db" }, (db) => {
  execMultiple(db, [
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY, name TEXT)",
    "CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, user_id INTEGER, title TEXT)",
    "CREATE INDEX IF NOT EXISTS idx_posts_user ON posts(user_id)",
  ]);
});
```

## Docker Compose

For development, a `docker-compose.yml` is provided that sets up a volume for persistent SQLite data:

```bash
docker compose up -d
```

## Package Ecosystem

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                       @mark1russell7/client-sqlite                           │
│                      (Procedure layer - uses docker-sqlite)                  │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                       @mark1russell7/docker-sqlite                           │
│                      (Connection + Query utilities)                          │
└───────────────────────────────────┬─────────────────────────────────────────┘
                                    │
                                    ▼
                          ┌─────────────────────┐
                          │       sql.js        │
                          │   (SQLite in WASM)  │
                          └─────────────────────┘
```

## License

MIT
