/**
 * Type declarations for sql.js
 */

declare module "sql.js" {
  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface Database {
    run(sql: string, params?: (string | number | Uint8Array | null)[]): void;
    exec(sql: string): QueryExecResult[];
    prepare(sql: string): Statement;
    export(): Uint8Array;
    close(): void;
    getRowsModified(): number;
  }

  export interface Statement {
    bind(params?: (string | number | Uint8Array | null)[]): boolean;
    step(): boolean;
    getAsObject(): Record<string, unknown>;
    getColumnNames(): string[];
    free(): void;
    reset(): void;
  }

  export interface QueryExecResult {
    columns: string[];
    values: unknown[][];
  }

  export default function initSqlJs(): Promise<SqlJsStatic>;
}
