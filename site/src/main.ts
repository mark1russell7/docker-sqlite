// The start of the page: the theme, SQLite in WebAssembly, the playground, the API table and the build line.
import { byId, copyText, h, setupTheme, showBuild } from "@mark1russell7/site-pages/chrome";
import { API, result } from "./api.ts";
import { message } from "./demo.ts";
import { Playground } from "./playground.ts";
import { loadSql } from "./sqlite.ts";
import "@mark1russell7/site-pages/shell.css";
import "./style.css";

setupTheme(byId<HTMLButtonElement>("theme"), "docker-sqlite-theme");

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
  button.addEventListener("click", () => void copyText(button, byId(button.dataset["copy"]!).textContent ?? ""));
}

showBuild(byId("build"), __BUILD__, "mark1russell7/docker-sqlite");

loadSql().then(
  (sql) => {
    new Playground(sql);
    byId("api-rows").replaceChildren(
      ...API.map((row) =>
        h(
          "tr",
          {},
          h("td", {}, ...row.names.map((name) => h("code", { class: "name" }, name))),
          h("td", {}, row.what),
          h(
            "td",
            { class: "live" },
            ...row.examples.map((example) =>
              h("div", { class: "ex" }, h("code", {}, example.code), h("span", { class: "arrow", "aria-hidden": "true" }, "→"), h("output", {}, result(sql, example))),
            ),
            row.note === undefined ? null : h("span", { class: "note" }, row.note),
          ),
        ),
      ),
    );
  },
  (error: unknown) => {
    const engine = byId("engine");
    engine.dataset["ready"] = "false";
    engine.textContent = `SQLite did not load: ${message(error)}`;
  },
);
