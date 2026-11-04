/**
 * The entry `./pure` imports no `node:` module, so a browser bundle can import it.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import * as main from "./index.js";
import * as pure from "./pure.js";

const here = dirname(fileURLToPath(import.meta.url));

/** The module names that a source file imports, also the type-only imports. */
function importsOf(file: string): string[] {
  const text = readFileSync(join(here, file), "utf8");
  return [...text.matchAll(/(?:import|export)\s[^"';]*?from\s*"([^"]+)"/g)].map((m) => m[1]!);
}

/** The source files that `entry` imports, directly or through other files, with `entry`. */
function graph(entry: string): Map<string, string[]> {
  const seen = new Map<string, string[]>();
  const visit = (file: string): void => {
    if (seen.has(file)) return;
    const imports = importsOf(file);
    seen.set(file, imports);
    for (const name of imports) {
      if (name.startsWith("./")) visit(name.slice(2).replace(/\.js$/, ".ts"));
    }
  };
  visit(entry);
  return seen;
}

describe("the entry ./pure", () => {
  it("imports no node: module and no file access", () => {
    const files = graph("pure.ts");
    expect([...files.keys()].sort()).toEqual(["migrate.ts", "pure.ts", "query.ts", "types.ts"]);
    const external = [...files.values()].flat().filter((name) => !name.startsWith("./"));
    expect(new Set(external)).toEqual(new Set(["sql.js"]));
  });

  it("has the same functions as the main entry, except the connections", () => {
    const connections = ["withConnection", "createConnection", "DatabaseFileChangedError"];
    const expected = Object.keys(main).filter((name) => !connections.includes(name)).sort();
    expect(Object.keys(pure).sort()).toEqual(expected);
    for (const name of expected) {
      expect(pure[name as keyof typeof pure], name).toBe(main[name as keyof typeof main]);
    }
  });
});
