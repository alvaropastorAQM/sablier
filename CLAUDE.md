# Sablier

Engagement tracking for freelancers: time log, monthly statement and PDF
invoice, tasks, notes, deadlines, reminders. Interface in plain HTML/CSS/JS
with no framework (`index.html`, `js/`, `css/`), backend in Rust with Tauri 2
(`src-tauri/`). The README describes each page, the calculation rules and
the code layout.

**On Windows: read `docs/MIGRATION-WINDOWS.md` before anything else.** The
app is currently macOS only (`src-tauri/src/mac.rs` calls AppKit and
WebKit); that guide says what to port, in which order, and how to check it.

## Commands

```bash
npm test         # calculation engine (node) then Rust backend (cargo test)
npm start        # runs the app (on the user's real data)
npm run smoke    # self-test on a disposable folder (POSIX syntax)
```

The full self-test and its variables (`SABLIER_SMOKE_*`) are described in
the README and at the top of `src-tauri/src/autotest.rs`. It never runs on
the real data (refused without `SABLIER_DONNEES`).

## Rules

- Identifiers stay in French; comments and all user-visible text are in
  English.
- No em dash in interface texts; every colour goes through the tokens of
  `css/styles.css`.
- The format of the data files does not change: `donnees.rs` writes like
  `JSON.stringify(objet, null, 2) + '\n'`.
- A change is checked with `npm test` and the self-test; a test is never
  removed to make it pass.
