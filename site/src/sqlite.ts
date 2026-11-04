// sql.js in the browser. Vite copies the WebAssembly file of sql.js into the build, below the base of the site.
// Thus the page loads SQLite from its own origin, with no CDN.
import initSqlJs, { type SqlJsStatic } from "sql.js";
import wasmUrl from "sql.js/dist/sql-wasm-browser.wasm?url";

let loading: Promise<SqlJsStatic> | null = null;

/** sql.js, loaded one time. */
export function loadSql(): Promise<SqlJsStatic> {
  loading ??= initSqlJs({ locateFile: () => wasmUrl });
  return loading;
}
