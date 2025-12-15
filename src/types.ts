/**
 * Type definitions for docker-sqlite
 */

import type { Database } from "sql.js";

/**
 * Configuration for SQLite connection
 */
export interface ConnectionConfig {
  /** Path to the SQLite database file. Use ":memory:" for in-memory database */
  dbPath: string;
}

/**
 * Callback function for withConnection
 */
export type ConnectionCallback<T> = (db: Database) => T | Promise<T>;

/**
 * Result of a query operation
 */
export interface QueryResult<T = Record<string, unknown>> {
  /** Column names */
  columns: string[];
  /** Row values */
  rows: T[];
}

/**
 * Result of an execute operation (INSERT, UPDATE, DELETE)
 */
export interface ExecuteResult {
  /** Number of rows affected */
  changes: number;
}

/**
 * Migration definition
 */
export interface Migration {
  /** Migration version (must be unique and sequential) */
  version: number;
  /** Description of the migration */
  description: string;
  /** SQL to apply the migration */
  up: string;
  /** SQL to revert the migration (optional) */
  down?: string;
}

/**
 * Migration status
 */
export interface MigrationStatus {
  /** Current version (0 if no migrations applied) */
  currentVersion: number;
  /** List of applied migrations */
  appliedMigrations: number[];
  /** List of pending migrations */
  pendingMigrations: Migration[];
}
