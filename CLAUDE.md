# Sablier

Engagement tracking for freelancers: time log, monthly statement and PDF
invoice, tasks, notes, deadlines, reminders. Interface in plain HTML/CSS/JS
with no framework (`index.html`, `js/`, `css/`), backend in Rust with Tauri 2
(`src-tauri/`). The README describes each page, the calculation rules and
the code layout.

The app runs on macOS and on Windows (ARM64 and x64, with WebView2). The
platform code is `src-tauri/src/mac.rs` (AppKit and WebKit) or
`src-tauri/src/windows.rs` (Tauri plugins and WebView2); `main.rs` picks one
at compile time and both expose the same functions. `docs/MIGRATION-WINDOWS.md`
tells how the Windows port was done and how it is checked.

## Commands

```bash
npm test                  # calculation engine (node) then Rust backend (cargo test)
npm start                 # runs the app (on the user's real data)
npm run smoke             # self-test on a disposable folder, same command on Mac and Windows
npm run app:build         # macOS: tests, build, full self-test, install into /Applications
npm run app:build:windows # Windows: same steps, install into %LOCALAPPDATA%\Programs\Sablier
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
