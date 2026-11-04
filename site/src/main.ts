// The start of the page: the theme, SQLite in WebAssembly, the playground, the API table and the build line.
import { byId, copyText, h, setupTheme } from "@mark1russell7/site-pages/chrome";
import { API, result } from "./api.ts";
import { message } from "./demo.ts";
import { Playground } from "./playground.ts";
import { loadSql } from "./sqlite.ts";
import "./style.css";

setupTheme(byId<HTMLButtonElement>("theme"), "docker-sqlite-theme");

for (const button of document.querySelectorAll<HTMLButtonElement>("button[data-copy]")) {
  button.addEventListener("click", () => void copyText(button, byId(button.dataset["copy"]!).textContent ?? ""));
}

byId("build").append(
  `Version ${__BUILD__.version}, build `,
  __BUILD__.sha === "local" ? "local" : h("a", { href: `https://github.com/mark1russell7/docker-sqlite/commit/${__BUILD__.sha}` }, __BUILD__.sha),
  ` of ${__BUILD__.date}`,
);

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
