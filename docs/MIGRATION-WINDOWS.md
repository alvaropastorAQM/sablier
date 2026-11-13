# Running Sablier on Windows

Guide for the agent (Claude Code) porting Sablier to Windows. Read it in
full before touching the code.

## Where things stand

Sablier is a **macOS** application: the interface (`index.html`, `js/`,
`css/`) is plain HTML/CSS/JS with no framework, and the backend is in Rust
with Tauri 2 (`src-tauri/`). The interface is already portable. The backend,
on the other hand, calls AppKit, WebKit and UserNotifications directly
through `objc2` (file `src-tauri/src/mac.rs`) and assumes macOS paths. **As
it stands, it does not compile on Windows.**

The goal: the same application on Windows 10/11, with WebView2 (Edge)
instead of WebKit, without breaking the macOS version. Tauri already
handles window, menus, IPC and protocols on both systems; what remains is
replacing what `mac.rs` does by hand and fixing the few places written for
macOS.

## Ground rules

- **Break nothing on Mac.** Any system-specific code goes behind
  `#[cfg(target_os = "macos")]` / `#[cfg(windows)]`. The current macOS
  behaviour stays identical.
- **Same module, two implementations.** Keep `mac.rs` as it is and create
  `windows.rs` with **the same public functions, same signatures**
  (`enregistrer_sous`, `ouvrir_panneau`, `alerte`, `imprimer_pdf`,
  `preparer_notifications`, `notifier`, `pastille`, `corbeille`, `executer`,
  `capturer`, `fantome`), then pick the file at compile time:

  ```rust
  #[cfg_attr(target_os = "macos", path = "mac.rs")]
  #[cfg_attr(windows, path = "windows.rs")]
  mod mac;
  ```

  `main.rs` and `autotest.rs` then need almost no change.
- **The data format does not move.** `donnees.rs` writes exactly like
  `JSON.stringify(objet, null, 2) + '\n'` (key order, exact numbers:
  `preserve_order` and `float_roundtrip` features of `serde_json`). Do not
  touch it.
- **The tests are the judge.** `npm test` and the self-test (below) must
  pass on Windows at the end. A test is never removed to make it pass.
- Identifiers stay in French; comments and all user-visible text are in
  English. Style rule: no em dash in interface texts.

## Setting up the Windows machine

1. **Rust** with the MSVC toolchain: `rustup default stable-x86_64-pc-windows-msvc`.
2. **Visual Studio Build Tools**, "Desktop development with C++" workload
   (MSVC linker and Windows SDK). Without them, nothing links.
3. **WebView2 Runtime**: already present on Windows 11 and on an up-to-date
   Windows 10; otherwise install it from Microsoft's site.
4. **Node.js** for `npm test` (the calculation engine is tested in JS). No
   npm dependency to install.

## What is Mac-specific, and what to use instead

### `src-tauri/Cargo.toml`

- The crates `objc2`, `block2`, `objc2-foundation`, `objc2-app-kit`,
  `objc2-web-kit`, `objc2-user-notifications` do not compile on Windows:
  move them to `[target.'cfg(target_os = "macos")'.dependencies]`.
- Add for Windows, in `[target.'cfg(windows)'.dependencies]`:
  - `webview2-com` and `windows` (access to WebView2 for the PDF and the
    self-test). **Use exactly the versions already pulled in by `wry`**
    (`cargo tree -i webview2-com` after a first `cargo build`), otherwise
    two incompatible versions of the COM types coexist.
  - `tauri-plugin-dialog` (Save/Open panels, alerts),
    `tauri-plugin-notification`, `tauri-plugin-opener` (open, reveal in
    Explorer, open a URL), `trash` (recycle bin). These plugins also work
    on Mac, but **the macOS version does not change**: Windows side only.
- The `macos-private-api` and `devtools` features of `tauri` can stay.

### `src-tauri/tauri.conf.json` and icons

- `tauri-build` requires `src-tauri/icons/icon.ico` on Windows (resource of
  the executable). Generate it from `icon.png` (`npx @tauri-apps/cli icon
  src-tauri/icons/icon.png`, or Pillow) and add it to `bundle.icon`.
- `identifier`: `com.example.sablier`, keep it.

### `src-tauri/src/main.rs`

| Place | On Mac | On Windows |
|---|---|---|
| `accueil()`, `documents()`, `racine` in `main()` | `$HOME/Library/Application Support/Sablier`, `$HOME/Documents` | `HOME` does not exist. Data: `%APPDATA%\Sablier\Donnees` (`std::env::var_os("APPDATA")`), preferences `%APPDATA%\Sablier\preferences.json`. Documents: `app.path().document_dir()` in the commands. |
| `ouvrir()` | `/usr/bin/open` and `open -R` | `tauri-plugin-opener`: `open_path`, `reveal_item_in_dir`, `open_url` (or `explorer` and `explorer /select,<path>`). |
| `creer_fenetre()` | `title_bar_style(Overlay)`, `hidden_title`, `traffic_light_position`, `transparent` + `Effect::Sidebar`, URL `index.html?vibrance=1` | These methods only exist on macOS (compile error): `cfg`. On Windows, normal title bar, opaque window, URL `index.html` **without** `?vibrance=1` (the page then keeps its background). |
| Closing the window | hidden, the app stays in the Dock (`CloseRequested` → `hide`) | Without a Dock, a hidden window leaves an invisible process: on close, call `quitter(app)` (empties the page, flushes the writes, quits). |
| `RunEvent::Reopen` | click on the Dock | only exists on macOS: `cfg`. |
| `menu()` | "Sablier" application menu (About, Hide, Hide others, Show all), `set_as_windows_menu_for_nsapp` | `hide`, `hide_others`, `show_all` have no effect on Windows: remove them; `set_as_windows_menu_for_nsapp` only exists on macOS. The `CmdOrCtrl+…` shortcuts become Ctrl+… on their own. |
| `rappels_badge` / `pastille` | Dock badge | no Dock: do nothing (or a taskbar overlay icon, optional). |
| `dans_bundle()` | only enables notifications inside a `.app` | not applicable. |

### Internal protocols (the main trap)

The backend serves two protocols: `sablier` (the data and `window.sablier`
when the page loads) and `sablier-piece` (the images attached to tasks).
**On Windows, WebView2 does not know these schemes**: Tauri exposes them as
`http://<scheme>.localhost/<path>`.

- `index.html` loads `sablier://localhost/demarrage.js` before the page
  scripts. On Windows it must be `http://sablier.localhost/demarrage.js`.
  The simplest way: `src-tauri/build.rs` already copies `index.html` into
  `dist/`; it can replace `sablier://localhost/` with
  `http://sablier.localhost/` there when `CARGO_CFG_TARGET_OS` is
  `windows`. The CSP of `index.html` (`meta` tag) must then allow
  `http://sablier.localhost` in `script-src` and
  `http://sablier-piece.localhost` in `img-src`.
- `js/pont.js`, `pieces.url()`: returns `sablier-piece://pieces/<path>`. On
  Windows (page served from `http://tauri.localhost`), return
  `http://sablier-piece.localhost/pieces/<path>`. Also set `plateforme` to
  the right value (the backend can pass it in `__SABLIER_DEMARRAGE`).
- `servir_piece()` (main.rs): on Mac the host is `pieces` and the path is
  `/<task>/<file>`; on Windows the host is the scheme and the path starts
  with `/pieces/`. Strip that prefix before `chemin_dans`.
- `tests/scenario-smoke.js`, key `imageUrl`: accept both URL forms.

Tauri's IPC already goes through `http://ipc.localhost` on Windows; the CSP
allows it.

### `src-tauri/src/windows.rs` (to write)

- **Panels and alerts**: `tauri-plugin-dialog`, `blocking_*` calls (the
  commands that use them are already `async`, so off the main thread).
  `alerte` returns the button index: `MessageDialogButtons::OkCancelCustom`
  returns `true` for the first button.
- **Notifications**: `tauri-plugin-notification`. Clicking a notification
  (which opens the reminders on Mac) is not handled by the plugin on
  Windows; acceptable. Without an installer, toasts show up under the name
  of PowerShell: that is normal in development.
- **Recycle bin**: `trash::delete(path)`.
- **PDF**: see the next section.
- **Self-test** (`executer`, `capturer`, `fantome`): see further down.

### The PDFs: `imprimer_pdf`

On Mac, `mac.rs` renders the HTML (statement, invoice) in a hidden window
and prints it with WebKit. Two corrections there are **specific to WebKit**
and must **not** be carried over to Windows:

- the `0.75 / 0.8` zoom (WebKit prints 1 CSS px as 0.8 pt, Chromium as
  0.75 pt);
- `src-tauri/src/paginer.js` (WebKit cuts table rows between two pages and
  does not repeat the header; Chromium does it by itself thanks to the CSS
  of the templates).

WebView2 is Chromium: the PDFs will be those of the old Electron version.
The method:

1. Hidden window (`WebviewWindowBuilder`, `visible(false)`), no IPC.
2. Load the HTML. `NavigateToString` is limited to 2 MB: a long statement
   may exceed it; write the HTML to a temporary file and navigate to it
   instead, or serve it through an internal protocol.
3. Wait for the page to be loaded and for `document.fonts.ready`.
4. `with_webview` → `controller().CoreWebView2()` → `cast::<ICoreWebView2_7>()`
   → `PrintToPdf(path, settings, PrintToPdfCompletedHandler)`. The settings
   come from `ICoreWebView2Environment6::CreatePrintSettings` (environment
   through `ICoreWebView2_2::Environment`): A4 page in inches
   (8.2677 × 11.6929), `ShouldPrintBackgrounds = true`,
   `ShouldPrintHeaderAndFooter = false`. The margins are those of the
   templates' `@page` (16 mm at the top, 15 mm on the sides, 18 mm at the
   bottom): check on the PDF that they do not add up to those of the
   settings (otherwise set the latter to 0, or to the `@page` values).
5. Wait for the callback, close the window, return `Ok(())` or the error
   message.

**Fonts**: the PDF templates bundle Nunito Sans and Charter (embedded from
`css/fonts`), so the rendering no longer depends on the fonts installed on
the system. Check that the bundled files load in the hidden window before
printing (`document.fonts.ready`).

**Reference**: `docs/reference/facture-2026-02.pdf` and
`docs/reference/releve-2026-08.pdf` are the PDFs of the Mac version for the
demo data set (`node outils/jeu-demo.js <folder>`). The Windows PDFs must
have the same number of pages (2 and 2), the same lines at the top of each
page, no cut table row, the table header repeated, A4 format. Only the font
may differ.

### `src-tauri/src/donnees.rs` (tests)

The code is portable (`File::sync_all` = `FlushFileBuffers`, `fs::rename`
replaces the target on Windows). But **the tests simulate a full disk by
making the folder read-only** (`std::os::unix::fs::PermissionsExt`, mode
`0o555`). That does not compile on Windows, and a read-only folder does not
prevent writing there. Replace the failure with a portable means: create a
**folder** in place of each `<name>.json.tmp` (`fs::create_dir`);
`File::create` then fails on both systems. `retablir` removes those
folders. The assertions stay the same.

### `src-tauri/src/fichiers.rs`

`nettoyer_nom_fichier` already removes `/ \ :` and control characters.
Windows also rejects `< > " | ? *`, names ending in a dot or a space, and
reserved names (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…`COM9`, `LPT1`…`LPT9`,
with or without an extension). Add them (for Windows only, or everywhere:
it is risk-free on Mac), with a test.

### `src-tauri/src/autotest.rs` and the self-test

The self-test (`SABLIER_SMOKE=1`) plays the real app in an invisible
window: page screenshots, `tests/scenario-smoke.js` (88 checks),
`tests/scenario-audit.js` (60 with the demo data set), the two PDFs, and
the console errors. It depends on three functions of `mac.rs`:

- `executer(window, body)`: runs an **async function body** in the page and
  returns its value. Under WebView2, `ExecuteScript` does not wait for
  promises; use `CallDevToolsProtocolMethod("Runtime.evaluate", …)` with
  `awaitPromise: true` and `returnByValue: true`, on
  `(async function () { <body> })()`, then read `result.value`.
- `capturer`: `CallDevToolsProtocolMethod("Page.captureScreenshot")`
  returns a base64 PNG.
- `fantome`: on Mac, the window is shown but transparent, because a hidden
  window freezes timers. WebView2 also slows down a hidden window: show the
  window off-screen (negative position) or leave
  `controller().SetIsVisible(true)`.

`npm run smoke` uses POSIX syntax for environment variables. In
PowerShell:

```powershell
node outils/jeu-demo.js "$env:TEMP\sablier-test"
$env:SABLIER_SMOKE='1'; $env:SABLIER_SMOKE_SCENARIO='1'; $env:SABLIER_SMOKE_AUDIT='1'; $env:SABLIER_SMOKE_PDF='1'
$env:SABLIER_DONNEES="$env:TEMP\sablier-test"; $env:SABLIER_CAPTURES="$env:TEMP\sablier-captures"
cargo run --manifest-path src-tauri/Cargo.toml
```

Making `npm run smoke` portable (a small Node script that sets the
variables) is welcome.

### Build and installation

`scripts/installer.js` is Mac-specific (`codesign`, `ditto`,
`/Applications`, `SetFile`, `osascript`). On Windows:

- `cargo build --release --manifest-path src-tauri/Cargo.toml` produces
  `src-tauri/target/release/sablier.exe`, self-contained (the page is
  embedded; WebView2 is provided by Windows). That is enough to use it.
- For an installer: `npm i -D @tauri-apps/cli`, `bundle.active: true`,
  `targets: ["nsis"]`, then `npx tauri build`.
- Keep the spirit of the Mac installer: tests, then self-test on the built
  binary, and only then installation.

### Interface

- Keyboard shortcuts already accept Ctrl like ⌘ (`metaKey || ctrlKey`
  everywhere).
- The interface texts show Ctrl+ shortcut hints, which suit Windows as they
  are.
- The interface font ends in `system-ui`: Segoe UI on Windows, nothing to
  do.
- Without `?vibrance=1`, the page keeps its opaque background: nothing to
  do. The top margin of the sidebar, made for the Mac window buttons, can
  be reduced on Windows (cosmetic).

## Suggested order

1. `Cargo.toml` (per-system dependencies) and `icon.ico`, then
   `cargo build` until it compiles, with a `windows.rs` whose functions
   first return a clear error.
2. Paths (`APPDATA`, Documents), window, menus, closing.
3. Protocols (`build.rs`, `pont.js`, `servir_piece`): the page must start
   with the data (`window.sablier` defined, no console error).
4. `donnees.rs` tests made portable: `npm test` green.
5. `executer`, `capturer`, `fantome`: the self-test runs.
6. Panels, alerts, notifications, recycle bin, open.
7. PDFs, compared with the references.
8. `nettoyer_nom_fichier` for Windows names.

## When it is done

- [ ] `npm test`: 57 JS tests and all Rust tests green on Windows.
- [ ] Full self-test on the demo data set: `SABLIER_SMOKE_OK`, 88 checks of
      the scenario and 60 of the audit at `true`, no `SABLIER_CONSOLE`
      line.
- [ ] Statement and invoice PDFs match the references (pages, page starts,
      whole rows, repeated header, A4, margins).
- [ ] By hand: save a PDF, export and import a backup, choose the invoices
      folder (invoice PDFs are filed there in a month subfolder), attach a
      file with the button and then by dragging it from Explorer, open it
      and remove it (it goes to the recycle bin), receive a reminder
      notification, close the window then relaunch: nothing is lost.
- [ ] The data is in `%APPDATA%\Sablier\Donnees`, one dated copy per day in
      `Sauvegardes`.
- [ ] On Mac, nothing has changed (if a Mac is available: `npm test` and
      the self-test still pass there).
