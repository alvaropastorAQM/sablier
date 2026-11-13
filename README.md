# Sablier

Desktop app for tracking an assignment: the time spent for a client,
the monthly activity statement and the invoice that goes with it, tasks,
notes, the admin calendar of a micro-business and the reminders that
come with it.

"Graphite" design (`design/design_system_macos27.md`) since 25/10/2026: cool neutrals, steel-blue accent, macOS glass, dark and light following the system; the PDFs have their own style (white, navy, gold, serif headings); same technique
(Electron, plain HTML/CSS/JS, data in readable JSON files).

## Run and build

```bash
npm install          # once
npm start            # runs the app in development
npm test             # tests of the calculation engine and of data writing (node)
npm run smoke        # self-test on /tmp/sablier-smoke, never on the real data
npm run app:build    # builds dist-app/mac-arm64/Sablier.app, then installs it in /Applications
npm run app:install  # only copies the build again into /Applications
```

The app is launched from `/Applications/Sablier.app` (Dock, Spotlight).
Every build is copied there automatically: an old copy left in
/Applications would bring back defects that are already fixed.

Full self-test, on a throwaway data folder (never the real one):

```bash
SABLIER_SMOKE=1 SABLIER_SMOKE_SCENARIO=1 SABLIER_SMOKE_PDF=1 SABLIER_DONNEES=/tmp/sablier-test SABLIER_CAPTURES=/tmp/sablier-test npx electron .
```

The app must be closed beforehand (one instance at a time).

## Running on Linux

```bash
npm install                # once
npm start                  # runs the app in development
npm test                   # tests of the calculation engine and of data writing (node)
npm run app:build:linux    # builds dist-app/linux-*-unpacked and registers a .desktop entry
```

`npm run app:build:linux` builds `dist-app/linux-*-unpacked` and registers a
`.desktop` entry, which WSLg lists in the Windows Start menu. On Linux the
data lives in `~/.config/Sablier/Donnees`.

## What each page does

| Page | Role |
|---|---|
| Reminders (sidebar button, Ctrl+Shift+R) | Everything that must not be missed: deadlines, dated tasks, months to invoice, invoices to collect, forgotten timer, neglected log; snooze until tomorrow or for a week, mark done |
| Dashboard | Current reminders, billable hours and billable amount for the period, earned since the start (issued invoices, paid share), what to set aside for URSSAF and the date of the next direct debit (since 27/10/2026), hours per month, breakdown by area, upcoming tasks and deadlines |
| Log and statement | The work of the billing month day by day (work items, billed time, amount, status); a day unfolds into its log entries (edit, duplicate, delete, resume on the timer); "Add an entry" (Ctrl+N); in an entry's sheet: linked task and billing month; moving work items to another month; invoice creation, which automatically saves the invoice and the PDF statement in the invoices folder (Settings), in a "YYYY-MM month" subfolder; once everything is invoiced, the buttons with no purpose disappear. Issued invoices, the income ledger and the URSSAF quarters have their own tab, "Invoices and income" (since 27/10/2026). Timer: sidebar and banner (no more quick entry since 27/10/2026) |
| Tasks | To do / In progress / Done board, drag and drop, full task sheet (steps, attachments, linked notes, progress log, time spent), timer from a card |
| Notes | Pages and subpages, continuous editor in the style of Apple Notes (formatting bar, "/" menu, Markdown and keyboard shortcuts, paste always as plain text, undo and redo), ideas that can be turned into tasks, search in the content, strip of linked tasks |
| Deadlines | Admin calendar (ACRE, CFE, URSSAF, vigilance, review) and reminders, each with its own reminder lead time |
| Settings | Rate, rounding, identities, bank details, areas, social contributions, reminders and notifications, backups |

## Calculation rules

- A **work item** = same day + same area + same label. Its entries are
  added up; it counts for its exact time.
- The **billed time** is the exact total of the statement or the invoice,
  rounded once up to the next quarter hour (article 6.1 of the
  contract), adjustable in Settings. Since 26/10/2026 (the contractor's rule): rounding per work item made the client pay nearly two hours
  too many per month. The rounding appears on its own line ("Total rounded
  up to the next quarter hour") on the statement and in the invoice
  appendix; the invoice freezes it (`arrondiMinutes`). Flat fees stay
  outside the rounded total.
- **Amount** = billed hours x hourly rate; no VAT (VAT exemption).
- An entry can be **non-billable** (the time is still counted, the amount
  is €0, with a reason) or carry a **flat fee** (a fixed amount excl. tax
  that replaces hours × rate; the value at the hourly rate and the discount
  stay visible on the statement and the invoice).
- An **invoice** freezes the entries of the month that are not yet
  invoiced: a month can therefore carry several invoices (for example an
  invoice during the month, then the balance invoice at the end).
  Numbering is continuous per year (YYYY-NN, the year being that of the
  issue date): only the next number is accepted, and the date never
  precedes that of the previous invoice. The invoice also freezes the
  contractor and the client; the statement of an invoiced month stays the
  one from issue time, and "Regenerate the PDFs" adds a copy
  (`Facture-2026-01 (2).pdf`) without overwriting the existing PDFs. Only
  the last invoice can be deleted, and never once it is paid. An entry
  frozen on an invoice no longer changes date, area, duration, billing
  month or billability (only the label and the details remain editable)
  and cannot be deleted as long as the invoice exists; the remainder of a
  partly invoiced work item goes at its exact time on the next invoice,
  which rounds its own total. The payment term is frozen on the invoice.
- **Billing month**: an entry is invoiced by default on the month of its
  date, but can be **moved** to a later month (field of the sheet, or the
  "Move to another month" button of the statement). The log, the dashboard
  and the badges stay on the month of the work; the statement, the invoice
  and the "month to invoice" reminder follow the billing month. A move
  always carries the whole work item; entries that an invoice has frozen
  can no longer be moved. The original statement and the target one each
  announce it with a banner, and the entry carries the mention "Done in
  September 2026" on screen as on the statement PDF. The **invoice**, on the
  other hand, does not say when the work was done: no date, no original
  month, and its appendix groups the work items by area and label (one row
  per work item, times and amounts added up); the log, the statement and
  the frozen entries of the invoice keep the date. If a work item still
  ends up straddling two months (hand-edited file, import), loading
  realigns its entries on a single month.
- **Rounding**: the amounts of a work item stay exact (like the cells of
  the spreadsheet); only totals and display are rounded to the cent
  (commercial rounding), so that "billed hours × rate" comes out right on
  the invoice.
- **Durations**: the typed duration takes precedence; start and end only
  serve to pre-fill it. Hours that would give more than sixteen hours (end
  before start) are refused. A timer stopped during a pause ends at the
  start of the pause.
- **PDF documents**: in the header, only the useful mentions (name followed
  by "EI", address on two lines, SIRET, contact). The invoice (redone on
  26/10/2026): issuer on the left, number, issue date and due date on the
  right, client offset, description, "Total due", VAT exemption mention,
  then "Payment terms" (due date, early payment discount none, late payment
  penalties and fixed recovery fee of €40, always printed because they are
  mandatory between professionals; account holder, bank, IBAN in groups of
  four, BIC). Its appendix groups the work items by area, with subtotals,
  without dates (the dated activity statement is attached separately).
- `outils/importer-git.js` rebuilds work sessions from the history of a git
  repository and loads them into the log (preview by default, `--appliquer`
  to write, `--coefficient 0.6` to weight). It refuses to write if a line
  of the source is carried by an invoice, and keeps the manual annotations
  (non-billable and its reason, flat fee, billing month) by attaching them
  to the work, not to the session number; those that no longer find their
  work are reported.
- **Social contributions** are estimated on the revenue collected, at the
  ACRE rate until its end date, then at the full rate.
- A past month of the contract is claimed by the **reminders** as soon as
  anything is left to invoice, travel expenses included.
- **Tasks** sort themselves in each column: high priority, then medium,
  then low, and at equal priority the nearest due date first. The effective
  priority is the highest between the manual choice and the one dictated by
  the due date (under 5 days: high; up to 14 days: medium; beyond: low). A
  manual choice is never lowered.
- **Ideas** live in the notes ("Loose ideas" page, "Idea" style); "Turn
  into a task" creates the task in To do, linked to the page. The former
  "Ideas" cards were migrated to this page.
- The **notes editor** (`js/page-notes.js`) is a single `contenteditable`
  area: one line on screen = one block in `notes.json`
  (`{id, type, html, coche, tache, retrait}`, format unchanged). Enter,
  Backspace, paste and undo are handled by the editor; after each native
  change, `normaliserDoc` puts the lines back in order. Pasted or dropped
  text is always inserted as plain text.
- **Reminders** (`calculerRappels` in `js/calculs.js`) have three levels:
  overdue, today, soon. Horizons are adjustable; each deadline can have its
  own. Desktop notifications: one per day for overdue and today's
  reminders, one on entering the horizon (then one per week) for "soon";
  grouped when there are several. App badge: overdue and today's reminders.
- Each **area** has a colour (Settings), reused on the cards, the log, the
  statement and the invoices.

## Data

Full audit (02/09/2026): `tests/scenario-audit.js` replays the edge cases
in the self-test (`SABLIER_SMOKE_AUDIT=1`): secondary modals of the task
sheet, cascading deletions, timer crossing midnight, old backup imported,
invoice number, partly invoiced work item, move to another billing month,
emptied fields, pages without data, cancelled drag. On load, files are
cleaned up (null elements dropped, missing ids assigned, numbers written
as strings converted, badly written billing month brought back to the
month of the work, entries of the same work item realigned on a single
billing month); an unreadable file is set aside and reported; pending
writes are flushed before any re-read or quit.

`~/Library/Application Support/Sablier/Donnees/` (macOS) or
`~/.config/Sablier/Donnees/` (Linux): `reglages.json`, `journal.json`,
`chantiers.json` (the tasks, historical name), `notes.json`,
`factures.json`, `echeances.json`, `chrono.json`. A dated copy is made in
`Sauvegardes/` once a day, even if the app stays open (30 kept). A write
refused by the disk is retried every 30 seconds, the alert comes back every
5 minutes, and Sablier warns before quitting if some data is still not
written. Files attached to tasks are copied into `Pieces/<task>/` (served
to the interface by the internal protocol `sablier-piece://`); they are not
part of the JSON export. Export and import of a full backup from Settings.

To work on a test data set without touching the real data:

```bash
node outils/jeu-demo.js /tmp/sablier-demo && SABLIER_DONNEES=/tmp/sablier-demo npm start
```

## Code layout

```
index.html            the shell: sidebar, pages, settings, user guide
css/styles.css        tokens and components (Graphite design)
js/bulle.js           Liquid Glass bubble for the selection
js/utils.js           dates, durations, formats (IBAN, phone, address, D-n)
js/calculs.js         engine: grouping, rounding, statement, invoices, quarters, priorities, reminders
js/donnees.js         state, persistence, default values, migrations
js/graphique.js       SVG bars
js/ui.js              navigation, notifications, modals, menus, icons
js/gabarits.js        PDF documents (statement, invoice)
js/rappels.js         reminders centre, desktop notifications, app badge
js/page-*.js          one page per file (page-factures.js is a view of page-releve.js)
js/app.js             startup
app/main.js           Electron main process: window, menus, bridge, attachments, self-test
app/preload.js        window.sablier
app/donnees.js        JSON files, daily backups
app/pdf.js            printing an HTML to PDF
outils/               icon, demo data set, git import, hiding the .app extension
tests/                node tests of the engine
```

Standing style rule: no em dash in the interface texts; every colour goes
through the tokens of `css/styles.css`.
