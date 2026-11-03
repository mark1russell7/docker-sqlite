/**
 * The probe of the playground. The site check of the Pages workflow starts it in a browser at each width, before the
 * deploy. A failed check stops the deploy.
 *
 * The site check reads this TypeScript file directly. It removes the types and the `export` line, and it starts the
 * result as the body of an async function.
 */

// The site check gives these helpers to the probe. Each element of this page is an HTML element.
declare const check: (name: string, ok: unknown, detail?: unknown) => boolean;
declare const until: <T>(fn: () => T | Promise<T>, ms?: number) => Promise<T>;
declare const $: (selector: string) => HTMLElement | null;
declare const $$: (selector: string) => HTMLElement[];
declare const type: (target: string | Element, text: string) => void;
declare const click: (target: string | Element) => void;

const meta = () => $("#result-meta");
const rows = () => meta()?.dataset["rows"] ?? "";
const changes = () => meta()?.dataset["changes"] ?? "";
const cells = () => $$("#result tbody td").map((td) => td.textContent ?? "");
const states = () => $$("#migrations li.mig").map((li) => `${li.dataset["version"]}:${li.dataset["state"]}`).join(" ");
const tables = () => $$("#tables li[data-table]").map((li) => `${li.dataset["table"]}=${li.dataset["rows"]}`).join(" ");
const log = () => $$("#log li.entry");
const traceText = () => (log()[0]?.querySelector(".trace")?.textContent ?? "");

check("SQLite loads from the site", await until(() => $("#engine")?.dataset["ready"] === "true", 15000), $("#engine")?.textContent);
check("the three migrations of the first example are applied", await until(() => states() === "1:applied 2:applied 3:applied"), states());
check("the first query shows the two users", await until(() => rows() === "2"), `${rows()} rows: ${cells().join("|")}`);
check("the rows hold the names of the users", cells().includes("Ada") && cells().includes("linus@example.com"), cells().join("|"));
check("the tables list has users, posts and _migrations", tables() === "_migrations=3 posts=3 users=2", tables());
check("the table _migrations has a row for each version", $$("#mig-table tbody tr").length === 3, $$("#mig-table tbody tr").length);
check("the log shows the SQL of the migrations", ($$("#log li.entry").find((li) => li.querySelector(".call")?.textContent === "runMigrations(db, migrations)")?.textContent ?? "").includes("SAVEPOINT docker_sqlite_migration"));

click('#queries [data-query="insert"]');
check("execute inserts one row", await until(() => changes() === "1"), changes());
check("the trace of execute shows its parameters", traceText().includes('params ["Grace","grace@example.com"]'), traceText());
check("the users table has three rows", await until(() => tables().includes("users=3")), tables());

click('#queries [data-query="by-name"]');
check("the query by name finds Ada", await until(() => rows() === "1" && cells().includes("Ada")), cells().join("|"));
type("#params", '["Grace"]');
click("#run-query");
check("new parameters change the row", await until(() => rows() === "1" && cells().includes("grace@example.com")), cells().join("|"));
type("#params", "not json");
click("#run-query");
check("bad parameters show an error", await until(() => meta()?.dataset["ok"] === "false"), meta()?.textContent);

type("#sql", "SELECT COUNT(*) AS n FROM posts WHERE user_id = ?");
type("#params", "[1]");
click("#run-query");
check("an edited query runs", await until(() => rows() === "1" && cells().join() === "2"), cells().join("|"));

click("#rollback");
check("the rollback removes the version 3", await until(() => states() === "1:applied 2:applied 3:pending"), states());
check("the rollback drops the posts table", await until(() => !tables().includes("posts")), tables());
click("#run-migrations");
check("the migrations run again", await until(() => states() === "1:applied 2:applied 3:applied"), states());

click('#presets [data-preset="fails"]');
check("the failed migration is marked", await until(() => states() === "1:applied 2:failed"), states());
check("the log shows the error of the migration", await until(() => (log()[1]?.dataset["ok"] ?? "") === "false" && (log()[1]?.textContent ?? "").includes("missing_table")), log()[1]?.textContent);
check("the savepoint keeps no part of the failed migration", !tables().includes("tags") && tables().includes("users"), tables());

click('#presets [data-preset="logs"]');
check("the logs schema of the package applies", await until(() => states() === "1:applied 2:applied" && rows() === "2"), `${states()} ${rows()}`);
click('#queries [data-query="bad-level"]');
check("the CHECK of the schema refuses a bad level", await until(() => meta()?.dataset["ok"] === "false" && cells().join().includes("CHECK")), cells().join("|"));

check(
  "the API table shows a live result for each example",
  $$("#api-rows tr").length === 10 && $$("#api-rows output").length === 10 && $$("#api-rows output").every((o) => (o.textContent ?? "") !== "" && !(o.textContent ?? "").startsWith("throws")),
  `${$$("#api-rows tr").length} rows, ${$$("#api-rows output").length} outputs`,
);

click('#presets [data-preset="app"]');
check("the first example comes back", await until(() => rows() === "2" && states() === "1:applied 2:applied 3:applied"), `${rows()} ${states()}`);

export {};
