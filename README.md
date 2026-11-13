# Sablier

macOS app for tracking a freelance engagement: the time spent for a client,
the monthly activity statement and the invoice that goes with it, tasks,
notes, the administrative calendar of the micro-business and the reminders
that come with it.

"Graphite" design (`design/design_system_macos27.md`) since 25 October 2026:
cool neutrals, steel-blue accent, macOS glass, dark or light following the
Mac. The PDFs have their own look (white, navy, gold, serif headings). The
interface is plain HTML/CSS/JS with no framework, and the data lives in
readable JSON files. The interface bundles open fonts in `css/fonts` (Inter,
Charter, JetBrains Mono), so it looks the same on any machine; Nunito Sans
and Charter are embedded in the PDFs.

Since 13 November 2026 the app runs on Tauri (Rust backend, `src-tauri/`)
instead of Electron: 12 MB instead of 280. The interface has not changed;
it talks to the backend through `window.sablier` (`js/pont.js`). Same data,
same folder, same file format, same PDFs (WebKit prints instead of Chromium:
a small script, `src-tauri/src/paginer.js`, keeps table rows whole and
repeats the header on every page).

## Run and build

```bash
npm start            # runs the app in development (on the real data)
npm test             # tests of the calculation engine (node) and of the Rust backend (data, files)
npm run smoke        # self-test on /tmp/sablier-smoke, never on the real data
npm run app:build    # tests, build of release/Sablier.app, full self-test, then install into /Applications
```

You need Node.js, Rust and the Xcode tools; there are no npm dependencies.
For now the app only runs on macOS; to port it to Windows, see
[docs/MIGRATION-WINDOWS.md](docs/MIGRATION-WINDOWS.md).
The app is launched from `/Applications/Sablier.app` (Dock, Spotlight).
Every build is copied there automatically, only if it passes the
self-test, after asking a running Sablier to quit: an old copy in
/Applications would bring back defects that are already fixed.

Full self-test, on a disposable data folder (never the real one):

```bash
SABLIER_SMOKE=1 SABLIER_SMOKE_SCENARIO=1 SABLIER_SMOKE_AUDIT=1 SABLIER_SMOKE_PDF=1 SABLIER_DONNEES=/tmp/sablier-test SABLIER_CAPTURES=/tmp/sablier-test cargo run --manifest-path src-tauri/Cargo.toml
```

It runs even while Sablier is open, in an invisible window, and exits with 0
if everything holds (`SABLIER_SMOKE_OK`), 1 otherwise (`SABLIER_SMOKE_ECHEC`
and the list). The scenarios are in `tests/scenario-smoke.js` and
`tests/scenario-audit.js`. With the screen locked or asleep, WebKit does not
render screenshots: they are reported, not counted as failures.

File format, checked on a copy of the real data (read back then rewritten,
they come out byte for byte identical):

```bash
SABLIER_VERIF=<copy of the Donnees folder> cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
```

## What each page does

| Page | Role |
|---|---|
| Reminders (sidebar button, Ctrl+Shift+R) | Everything you must not miss: deadlines, dated tasks, months to invoice, invoices to collect, forgotten timer, neglected log; snooze until tomorrow or for a week, mark done |
| Dashboard | Current reminders, billable hours and billable amount for the period, earned since the start (issued invoices, paid share), amount to set aside for URSSAF and date of the next direct debit (since 27 October 2026), hours per month, breakdown by area, upcoming tasks and deadlines |
| Log and statement | The work of the billing month day by day (work items, billed time, amount, status); a day unfolds into its log entries (edit, duplicate, delete, resume with the timer); "Add an entry" (Ctrl+N); in an entry's form: linked task and billing month; moving work items to another month; creating the invoice, which automatically files the invoice and the PDF statement in the invoices folder (Settings), in the "YYYY-MM month" subfolder; once everything is invoiced, the buttons with nothing left to do disappear. Issued invoices, the income ledger and the URSSAF quarters have their own tab, "Invoices and income" (since 27 October 2026). Timer: sidebar and banner (no more quick entry since 27 October 2026) |
| Tasks | To do / In progress / Done board, drag and drop, full sheet (steps, attachments, linked notes, progress log, time spent), timer from a card |
| Notes | Pages and subpages, continuous editor in the style of Apple Notes (formatting bar, "/" menu, Markdown and keyboard shortcuts, paste always as plain text, undo and redo), ideas that can become tasks, search in the content, strip of linked tasks |
| Deadlines | Administrative calendar (ACRE, CFE, URSSAF, watch-outs, annual accounts) and reminders, each with its own reminder lead time |
| Settings | Rate, rounding, identities, bank details, areas, social contributions, reminders and notifications, backups |

## Calculation rules

- A **work item** = same day + same area + same label. Its entries add up;
  it counts for its exact time.
- The **billed time** is the exact total of the statement or the invoice,
  rounded once up to the next quarter hour (article 6.1 of the contract),
  adjustable in Settings. Since 26 October 2026 (the contractor's rule):
  rounding per work item made the client pay nearly two hours too many per
  month. The rounding appears on its own line ("Total rounded up to the next
  quarter hour") in the statement and in the invoice annex; the invoice
  freezes it (`arrondiMinutes`). Flat fees stay outside the rounded total.
- **Amount** = billed hours x hourly rate; no VAT (VAT exemption).
- An entry can be **non-billable** (the time is still counted, the amount is
  €0, with a reason) or carry a **flat fee** (a fixed amount excl. tax that
  replaces hours × rate; the value at the hourly rate and the discount stay
  visible on the statement and the invoice).
- An **invoice** freezes the month's entries that are not invoiced yet: a
  month can therefore carry several invoices (for example one in the middle
  of the month, then the balance at the end). Numbering is continuous per
  year (YYYY-NN, the year being that of the issue date): only the next
  number is accepted, and the date never precedes that of the previous
  invoice. The invoice also freezes the contractor and the client; the
  statement of an invoiced month stays the one from the time of issue, and
  "Regenerate the PDFs" adds a copy (`Facture-2026-01 (2).pdf`) without
  overwriting the existing PDFs. Only the last invoice can be deleted, and
  never once it is paid. An entry frozen on an invoice no longer changes its
  date, area, duration, billing month or billing status (only the label and
  the details stay editable) and cannot be deleted while the invoice exists;
  the rest of a partly invoiced work item goes at exact time on the next
  invoice, which rounds its own total. The payment term is frozen on the
  invoice.
- **Billing month**: an entry is invoiced by default in the month of its
  date, but it can be **moved** to a later month (field of the form, or the
  "Move to another month" button of the statement). The log, the dashboard
  and the badges stay on the month of the work; the statement, the invoice
  and the "month to invoice" reminder follow the billing month. A move always
  takes the whole work item; entries that an invoice has frozen can no longer
  be moved. The statement of the month it leaves and the one it arrives in
  each announce it with a banner, and the entry carries the note
  "Done in September 2026" on screen as well as on the PDF statement. The
  **invoice**, for its part, does not say when the work was done: no date,
  no original month, and its annex groups the work items by area and label
  (one line per work item, time and amounts added up); the log, the
  statement and the frozen entries of the invoice keep the date. If a work
  item still ends up straddling two months (hand-edited file, import), the
  load realigns its entries on a single month.
- **Rounding**: the amounts of a work item stay exact (like the cells of
  the spreadsheet); only totals and display are rounded to the cent
  (commercial rounding), so that "billed hours × rate" comes out exact on
  the invoice.
- **Durations**: the typed duration wins; start and end only serve to
  pre-fill it. Hours that would give more than sixteen hours (end before
  start) are refused. A timer stopped during a pause ends at the start of
  the pause.
- **PDF documents**: the header carries only the useful details (name
  followed by "EI", address on two lines, SIRET, contact). The invoice
  (redone on 26 October 2026): issuer on the left, number, issue date and
  due date on the right, client offset, description, "Total due", VAT
  exemption notice, then "Payment terms" (due date, early payment discount
  none, late payment penalties and a fixed recovery fee of €40, always
  printed because they are mandatory between businesses; account holder,
  bank, IBAN in groups of four, BIC). Its annex groups the work items by
  area, with subtotals, without dates (the dated activity statement is
  attached separately).
- `outils/importer-git.js` rebuilds work sessions from the history of a git
  repository and adds them to the log (preview by default, `--appliquer` to
  write, `--coefficient 0.6` to weight). It refuses to write if an entry of
  the source is carried by an invoice, and it keeps manual annotations
  (non-billable and its reason, flat fee, billing month) by attaching them
  to the work, not to the session number; those that no longer find their
  work are reported.
- **Social contributions** are estimated on the revenue collected, at the
  ACRE rate until its end date, then at the full rate.
- A past month of the contract is claimed by the **reminders** as soon as
  anything is left to invoice, travel expenses included.
- **Tasks** sort themselves within each column: high priority, then medium,
  then low, and at equal priority the nearest due date first. The effective
  priority is the higher of the manual choice and the one dictated by the
  due date (under 5 days: high; up to 14 days: medium; beyond: low). A
  manual choice is never lowered.
- **Ideas** live in the notes ("Loose ideas" page, "Idea" style); "Turn
  into a task" creates the task in To do, linked to the page. The old
  "Ideas" cards were migrated to that page.
- The **notes editor** (`js/page-notes.js`) is a single `contenteditable`
  area: one line on screen = one block in `notes.json`
  (`{id, type, html, coche, tache, retrait}`, format unchanged). Enter,
  Backspace, paste and undo are handled by the editor; after every native
  edit, `normaliserDoc` puts the lines back in order. Pasted or dropped text
  is always inserted as plain text.
- **Reminders** (`calculerRappels` in `js/calculs.js`) have three levels:
  overdue, today, soon. The horizons are adjustable; each deadline can have
  its own. macOS notifications: one per day for overdue items and reminders
  of the day, one when entering the horizon (then one per week) for "soon";
  grouped when there are several. Dock badge: overdue items and reminders of
  the day.
- Each **area** has a colour (Settings), reused on the cards, the log, the
  statement and the invoices.

## Data

Full audit (2 September 2026): `tests/scenario-audit.js` replays the edge
cases in the self-test (`SABLIER_SMOKE_AUDIT=1`): secondary modals of the
sheet, cascading deletions, a timer crossing midnight, an old backup
imported, invoice number, partly invoiced work item, move to another billing
month, emptied fields, pages without data, cancelled drag. On load, the
files are sanitised (null elements dropped, missing ids assigned, numbers
stored as strings converted, misspelled billing month brought back to the
month of the work, entries of one work item realigned on a single billing
month); an unreadable file is set aside and reported; pending writes are
flushed before any re-read or quit.

`~/Library/Application Support/Sablier/Donnees/`: `reglages.json`,
`journal.json`, `chantiers.json` (the tasks, historical name), `notes.json`,
`factures.json`, `echeances.json`, `chrono.json`. A dated copy is made in
`Sauvegardes/` once a day, even if the app stays open (30 kept). A write
refused by the disk is retried every 30 seconds, the alert comes back every
5 minutes, and Sablier warns before quitting if data is still not written.
Files attached to tasks are copied into `Pieces/<task>/` (served to the
interface by the internal protocol `sablier-piece://`); they are not part of
the JSON export. Export and import of a full backup from Settings.

To work on a sample data set without touching the real data:

```bash
node outils/jeu-demo.js /tmp/sablier-demo && SABLIER_DONNEES=/tmp/sablier-demo npm start
```

## Code layout

```
index.html            the shell: sidebar, pages, settings, user guide
css/styles.css        tokens and components (Graphite design)
css/fonts.css         @font-face of the bundled fonts (files in css/fonts)
js/bulle.js           Liquid Glass bubble of the selection
js/utils.js           dates, durations, formats (IBAN, phone, address, D-n)
js/calculs.js         engine: grouping, rounding, statement, invoices, quarters, priorities, reminders
js/donnees.js         state, persistence, starting values, migrations
js/graphique.js       SVG bars
js/ui.js              navigation, notifications, modals, menus, icons
js/gabarits.js        PDF documents (statement, invoice)
js/rappels.js         reminders centre, macOS notifications, Dock badge
js/page-*.js          one page per file (page-factures.js is a view of page-releve.js)
js/app.js             startup
js/pont.js            window.sablier, served by the backend with the data (sablier://localhost/demarrage.js)
src-tauri/src/main.rs         window, menus, bridge commands, protocols (data, attachments)
src-tauri/src/donnees.rs      JSON files, deferred and retried writes, daily backups
src-tauri/src/fichiers.rs     safe names, attachments, free PDF names
src-tauri/src/mac.rs          AppKit and WebKit: PDF, panels, alerts, notifications, Dock, trash
src-tauri/src/paginer.js      PDF page breaks, run before printing
src-tauri/src/autotest.rs     self-test (SABLIER_SMOKE=1)
scripts/installer.js  build, check and install of Sablier.app
outils/               icon, demo data set, git import
tests/                node tests of the engine, self-test scenarios
```

Permanent style rule: no em dash in interface texts; every colour goes
through the tokens of `css/styles.css`.
