// The playground: the migrations, the query box, the result, the log, the tables and the table _migrations.
import { byId, h } from "@mark1russell7/site-pages/chrome";
import type { Migration, QueryResult } from "@mark1russell7/docker-sqlite/pure";
import type { SqlJsStatic } from "sql.js";
import {
  cellText,
  nextVersion,
  parseParams,
  PRESETS,
  Session,
  toMigrations,
  type LogEntry,
  type MigrationDraft,
  type Preset,
  type QueryMode,
  type RunResult,
  type SampleQuery,
} from "./demo.ts";

/** The state of a migration in the list. */
type MigrationState = "applied" | "edited" | "pending" | "failed";

const STATE_TEXT: Record<MigrationState, string> = {
  applied: "applied",
  edited: "applied, edited",
  pending: "pending",
  failed: "failed",
};

/** The most entries that the log shows. */
const LOG_SIZE = 40;

export class Playground {
  readonly #session: Session;
  #preset: Preset = PRESETS[0]!;
  #drafts: MigrationDraft[] = [];
  /** The up SQL of each applied version, when it was applied. */
  readonly #appliedUp = new Map<number, string>();
  #failed: number | null = null;
  #mode: QueryMode = "query";

  readonly #sql = byId<HTMLTextAreaElement>("sql");
  readonly #params = byId<HTMLInputElement>("params");

  constructor(sql: SqlJsStatic) {
    this.#session = new Session(sql);
    this.#renderPresets();
    this.#wire();
    for (const id of ["run-query", "run-migrations", "rollback", "reset", "download"]) byId<HTMLButtonElement>(id).disabled = false;
    const engine = byId("engine");
    engine.textContent = "SQLite is ready in this page.";
    engine.dataset["ready"] = "true";
    this.applyPreset(PRESETS[0]!.id);
  }

  /** A new database with the migrations of the example. The page runs the migrations, then the first query. */
  applyPreset(id: string): void {
    const preset = PRESETS.find((p) => p.id === id) ?? PRESETS[0]!;
    this.#preset = preset;
    for (const chip of byId("presets").querySelectorAll<HTMLButtonElement>("button")) chip.setAttribute("aria-pressed", String(chip.dataset["preset"] === preset.id));
    this.#session.reset();
    this.#appliedUp.clear();
    this.#failed = null;
    this.#drafts = preset.migrations.map((m) => ({ ...m }));
    this.#renderQueries();
    this.#renderDrafts();
    this.#migrate();
    this.#useQuery(preset.queries[0]!);
    this.#runQuery();
  }

  #wire(): void {
    byId("run-query").addEventListener("click", () => this.#runQuery());
    this.#sql.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        this.#runQuery();
      }
    });
    this.#params.addEventListener("keydown", (event) => {
      if (event.key === "Enter") this.#runQuery();
    });
    for (const button of byId("mode").querySelectorAll<HTMLButtonElement>("button")) {
      button.addEventListener("click", () => this.#setMode(button.dataset["mode"] as QueryMode));
    }
    byId("run-migrations").addEventListener("click", () => this.#migrate());
    byId("rollback").addEventListener("click", () => this.#rollback());
    byId("reset").addEventListener("click", () => {
      this.#session.reset();
      this.#appliedUp.clear();
      this.#failed = null;
      this.#refresh();
    });
    byId("download").addEventListener("click", () => this.#download());
    byId("add-migration").addEventListener("click", () => {
      const version = nextVersion(this.#drafts);
      this.#drafts.push({ version, description: `Migration ${version}`, up: "", down: "" });
      this.#renderDrafts();
      byId("migrations").querySelector<HTMLTextAreaElement>(`li[data-version="${version}"] textarea`)?.focus();
    });
  }

  #renderPresets(): void {
    byId("presets").replaceChildren(
      ...PRESETS.map((preset) => {
        const chip = h("button", { type: "button", class: "chip", "data-preset": preset.id, "aria-pressed": "false" }, preset.label);
        chip.addEventListener("click", () => this.applyPreset(preset.id));
        return chip;
      }),
    );
  }

  #renderQueries(): void {
    byId("queries").replaceChildren(
      ...this.#preset.queries.map((sample) => {
        const chip = h("button", { type: "button", class: "chip", "data-query": sample.id }, sample.label);
        chip.addEventListener("click", () => {
          this.#useQuery(sample);
          this.#runQuery();
        });
        return chip;
      }),
    );
  }

  #useQuery(sample: SampleQuery): void {
    this.#sql.value = sample.sql;
    this.#sql.rows = Math.min(8, Math.max(3, sample.sql.split("\n").length + 1));
    this.#params.value = sample.params;
    this.#setMode(sample.mode);
  }

  #setMode(mode: QueryMode): void {
    this.#mode = mode;
    for (const button of byId("mode").querySelectorAll<HTMLButtonElement>("button")) button.setAttribute("aria-checked", String(button.dataset["mode"] === mode));
  }

  /** The migrations of the drafts, or null when the drafts have a problem. The problems show below the list. */
  #migrations(): Migration[] | null {
    const { migrations, problems } = toMigrations(this.#drafts);
    byId("mig-problems").replaceChildren(...problems.map((p) => h("li", {}, p)));
    byId<HTMLButtonElement>("run-migrations").disabled = problems.length > 0;
    byId<HTMLButtonElement>("rollback").disabled = problems.length > 0;
    return problems.length > 0 ? null : migrations;
  }

  #migrate(): void {
    const migrations = this.#migrations();
    if (migrations === null) return;
    const pending = this.#session.status(migrations).pendingMigrations.map((m) => m.version);
    const outcome = this.#session.migrate(migrations);
    const applied = new Set(this.#session.status(migrations).appliedMigrations);
    for (const version of applied) {
      if (!this.#appliedUp.has(version)) this.#appliedUp.set(version, this.#drafts.find((d) => d.version === version)?.up ?? "");
    }
    this.#failed = outcome.ok ? null : (pending.find((v) => !applied.has(v)) ?? null);
    this.#refresh();
  }

  #rollback(): void {
    const migrations = this.#migrations();
    if (migrations === null) return;
    const outcome = this.#session.rollback(migrations);
    if (outcome.ok && outcome.value !== null) this.#appliedUp.delete(outcome.value.version);
    this.#failed = null;
    this.#refresh();
  }

  #runQuery(): void {
    const parsed = parseParams(this.#params.value);
    this.#params.setAttribute("aria-invalid", String(!parsed.ok));
    if (!parsed.ok) {
      this.#showError(parsed.error);
      return;
    }
    const outcome = this.#session.run(this.#mode, this.#sql.value, parsed.params);
    if (outcome.ok) this.#showResult(outcome.value, outcome.entry);
    else this.#showError(outcome.error);
    this.#refresh();
  }

  #showResult(run: RunResult, entry: LogEntry): void {
    const meta = byId("result-meta");
    meta.dataset["ok"] = "true";
    const table = byId<HTMLTableElement>("result");
    if (run.mode === "query") {
      const { columns, rows } = run.result;
      meta.dataset["rows"] = String(rows.length);
      delete meta.dataset["changes"];
      meta.textContent = `${rows.length} ${rows.length === 1 ? "row" : "rows"}, ${columns.length} ${columns.length === 1 ? "column" : "columns"}, ${entry.ms.toFixed(1)} ms`;
      fillTable(table, run.result);
    } else {
      meta.dataset["changes"] = String(run.result.changes);
      delete meta.dataset["rows"];
      meta.textContent = `${entry.ms.toFixed(1)} ms`;
      table.tHead!.replaceChildren(h("tr", {}, h("th", { scope: "col" }, "changes")));
      table.tBodies[0]!.replaceChildren(h("tr", {}, h("td", { class: "big" }, String(run.result.changes))));
    }
  }

  #showError(error: string): void {
    const meta = byId("result-meta");
    meta.dataset["ok"] = "false";
    delete meta.dataset["rows"];
    delete meta.dataset["changes"];
    meta.textContent = "Error";
    const table = byId<HTMLTableElement>("result");
    table.tHead!.replaceChildren();
    table.tBodies[0]!.replaceChildren(h("tr", {}, h("td", { class: "error", id: "query-error" }, error)));
  }

  #renderDrafts(): void {
    byId("migrations").replaceChildren(...this.#drafts.map((draft, index) => this.#draftItem(draft, index)));
    this.#renderStates();
  }

  #draftItem(draft: MigrationDraft, index: number): HTMLLIElement {
    const update = (patch: Partial<MigrationDraft>): void => {
      this.#drafts[index] = { ...this.#drafts[index]!, ...patch };
      this.#renderStates();
    };
    const id = `m${index}`;
    const version = h("input", { id: `${id}-version`, class: "mono version", type: "number", min: 1, step: 1, value: draft.version, "aria-label": "Version" });
    version.addEventListener("input", () => {
      const li = version.closest("li")!;
      li.dataset["version"] = version.value;
      update({ version: version.value === "" ? Number.NaN : Number(version.value) });
    });
    const description = h("input", { id: `${id}-description`, class: "description", type: "text", value: draft.description, "aria-label": "Description" });
    description.addEventListener("input", () => update({ description: description.value }));
    const up = h("textarea", { id: `${id}-up`, class: "mono", rows: Math.min(9, draft.up.split("\n").length + 1), spellcheck: "false", autocomplete: "off", autocapitalize: "off" });
    up.value = draft.up;
    up.addEventListener("input", () => update({ up: up.value }));
    const down = h("textarea", { id: `${id}-down`, class: "mono", rows: Math.min(4, Math.max(1, draft.down.split("\n").length)), spellcheck: "false", autocomplete: "off", autocapitalize: "off", placeholder: "No down SQL" });
    down.value = draft.down;
    down.addEventListener("input", () => update({ down: down.value }));
    const remove = h("button", { type: "button", class: "remove", "aria-label": `Remove the migration ${draft.version}` }, "Remove");
    remove.addEventListener("click", () => {
      this.#drafts.splice(index, 1);
      this.#renderDrafts();
    });
    return h(
      "li",
      { class: "mig", "data-version": draft.version },
      h("div", { class: "mig-head" }, h("span", { class: "v" }, "v"), version, description, h("span", { class: "state" }), remove),
      h("label", { class: "label", for: up.id }, "up"),
      up,
      h("label", { class: "label", for: down.id }, "down ", h("span", { class: "hint" }, "for rollbackMigration")),
      down,
    );
  }

  /** The state of each migration, the summary and the problems. */
  #renderStates(): void {
    const migrations = this.#migrations();
    const valid = migrations ?? [];
    const status = this.#session.status(valid);
    const applied = new Set(status.appliedMigrations);
    for (const li of byId("migrations").querySelectorAll<HTMLLIElement>("li.mig")) {
      const index = [...li.parentElement!.children].indexOf(li);
      const draft = this.#drafts[index]!;
      let state: MigrationState = "pending";
      if (applied.has(draft.version)) state = this.#appliedUp.has(draft.version) && this.#appliedUp.get(draft.version) !== draft.up ? "edited" : "applied";
      else if (this.#failed === draft.version) state = "failed";
      li.dataset["state"] = state;
      li.querySelector(".state")!.textContent = STATE_TEXT[state];
    }
    const unknown = status.appliedMigrations.filter((v) => !this.#drafts.some((d) => d.version === v));
    byId("mig-summary").textContent =
      `Version ${status.currentVersion}. ${status.pendingMigrations.length} pending.` + (unknown.length > 0 ? ` The database also has v${unknown.join(", v")}, which the list does not have.` : "");
  }

  #refresh(): void {
    this.#renderStates();
    this.#renderLog();
    this.#renderTables();
  }

  #renderLog(): void {
    const entries = this.#session.log.slice(-LOG_SIZE).reverse();
    byId("log").replaceChildren(
      ...entries.map((entry, i) =>
        h(
          "li",
          { class: "entry", "data-ok": String(entry.ok), "data-id": entry.id },
          h("div", { class: "entry-head" }, h("code", { class: "call" }, entry.call), h("span", { class: "ms" }, entry.ms === 0 ? "" : `${entry.ms.toFixed(1)} ms`)),
          h("p", { class: "summary" }, entry.summary),
          entry.trace.length === 0
            ? null
            : h(
                "details",
                { open: i === 0 },
                h("summary", {}, `${entry.trace.length} SQL ${entry.trace.length === 1 ? "text" : "texts"}`),
                h(
                  "ol",
                  { class: "trace" },
                  ...entry.trace.map((t) =>
                    h(
                      "li",
                      { "data-method": t.method },
                      h("span", { class: "method" }, t.method),
                      h("pre", {}, h("code", {}, t.sql.trim())),
                      t.params.length === 0 ? null : h("span", { class: "bound" }, `params ${JSON.stringify(t.params)}`),
                    ),
                  ),
                ),
              ),
        ),
      ),
    );
  }

  #renderTables(): void {
    const tables = this.#session.tables();
    byId("tables").replaceChildren(
      ...tables.map((table) => {
        const button = h("button", { type: "button", class: "table-btn" }, h("code", {}, table.name), h("span", { class: "count" }, `${table.rows} ${table.rows === 1 ? "row" : "rows"}`));
        button.addEventListener("click", () => {
          this.#useQuery({ id: "table", label: table.name, mode: "query", sql: `SELECT * FROM "${table.name.replaceAll('"', '""')}"`, params: "[]" });
          this.#runQuery();
          this.#sql.scrollIntoView({ block: "nearest" });
        });
        return h("li", { "data-table": table.name, "data-rows": table.rows }, button);
      }),
    );
    if (tables.length === 0) byId("tables").append(h("li", { class: "empty" }, "The database has no table."));
    const records = tables.some((t) => t.name === "_migrations")
      ? this.#session.peek("SELECT version, description, applied_at FROM _migrations ORDER BY version")
      : { columns: ["version", "description", "applied_at"], rows: [] };
    fillTable(byId<HTMLTableElement>("mig-table"), records);
  }

  #download(): void {
    const bytes = this.#session.export();
    const url = URL.createObjectURL(new Blob([new Uint8Array(bytes)], { type: "application/vnd.sqlite3" }));
    const link = h("a", { href: url, download: "playground.db" });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

/** A result in a table: the columns as the head and one row for each row. */
function fillTable(table: HTMLTableElement, result: QueryResult): void {
  table.tHead!.replaceChildren(h("tr", {}, ...result.columns.map((c) => h("th", { scope: "col" }, c))));
  table.tBodies[0]!.replaceChildren(
    ...(result.rows.length === 0
      ? [h("tr", {}, h("td", { class: "empty", colspan: Math.max(1, result.columns.length) }, "No rows."))]
      : result.rows.map((row) =>
          h(
            "tr",
            {},
            ...result.columns.map((c) => {
              const value = row[c];
              return h("td", { class: value === null ? "null" : typeof value === "number" ? "num" : undefined }, cellText(value));
            }),
          ),
        )),
  );
}
