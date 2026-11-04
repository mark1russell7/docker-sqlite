# Roadmap

This file is the plan of docker-sqlite. The Status page of the site reads it.

| ID | Item | Status | Summary |
| --- | --- | --- | --- |
| S1 | The site with a live demo | done | The site at GitHub Pages runs real SQLite in the browser with sql.js. A visitor edits the migrations, runs them and queries the rows. The log shows the SQL of each call. |
| S2 | The entry `./pure` | done | The query functions and the migrations import no Node.js module. A browser bundle imports them from `@mark1russell7/docker-sqlite/pure`. |
| S3 | Open a database file in the site | not started | The site can download its database. It can also open a `.db` file of the visitor, so the visitor can examine a real database. |
