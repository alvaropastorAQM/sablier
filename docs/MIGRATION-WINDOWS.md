# Faire tourner Sablier sous Windows

Guide pour l'agent (Claude Code) qui porte Sablier sous Windows. À lire en
entier avant de toucher au code.

## Où on en est

Sablier est une application **macOS** : l'interface (`index.html`, `js/`,
`css/`) est du HTML/CSS/JS sans framework, le fond est en Rust avec Tauri 2
(`src-tauri/`). L'interface est déjà portable. Le fond, lui, appelle
directement AppKit, WebKit et UserNotifications par `objc2` (fichier
`src-tauri/src/mac.rs`) et suppose des chemins macOS. **En l'état, il ne
compile pas sous Windows.**

Le but : la même application sous Windows 10/11, avec WebView2 (Edge) à la
place de WebKit, sans casser la version macOS. Tauri gère déjà fenêtre,
menus, IPC et protocoles sur les deux systèmes ; il reste à remplacer ce que
`mac.rs` fait à la main et à corriger les quelques endroits écrits pour macOS.

## Règles du chantier

- **Ne rien casser sur Mac.** Tout code propre à un système passe derrière
  `#[cfg(target_os = "macos")]` / `#[cfg(windows)]`. Le comportement macOS
  actuel reste identique.
- **Même module, deux implémentations.** Garder `mac.rs` tel quel et créer
  `windows.rs` avec **les mêmes fonctions publiques, mêmes signatures**
  (`enregistrer_sous`, `ouvrir_panneau`, `alerte`, `imprimer_pdf`,
  `preparer_notifications`, `notifier`, `pastille`, `corbeille`, `executer`,
  `capturer`, `fantome`), puis choisir le fichier à la compilation :

  ```rust
  #[cfg_attr(target_os = "macos", path = "mac.rs")]
  #[cfg_attr(windows, path = "windows.rs")]
  mod mac;
  ```

  `main.rs` et `autotest.rs` n'ont alors presque rien à changer.
- **Le format des données ne bouge pas.** `donnees.rs` écrit exactement comme
  `JSON.stringify(objet, null, 2) + '\n'` (ordre des clés, nombres exacts :
  features `preserve_order` et `float_roundtrip` de `serde_json`). Ne pas y
  toucher.
- **Les tests sont le juge.** `npm test` et l'auto-test (plus bas) doivent
  passer sous Windows à la fin. On ne retire pas un test pour le faire passer.
- Le projet est en français : identifiants, commentaires, messages.
  Règle de style : aucun tiret cadratin dans les textes de l'interface.

## Préparer la machine Windows

1. **Rust** avec la chaîne MSVC : `rustup default stable-x86_64-pc-windows-msvc`.
2. **Visual Studio Build Tools**, charge de travail « Développement Desktop en
   C++ » (éditeur de liens MSVC et SDK Windows). Sans eux, rien ne se lie.
3. **WebView2 Runtime** : déjà présent sur Windows 11 et sur Windows 10 à
   jour ; sinon l'installer depuis le site de Microsoft.
4. **Node.js** pour `npm test` (le moteur de calcul est testé en JS). Aucune
   dépendance npm à installer.

## Ce qui est propre au Mac, et quoi mettre à la place

### `src-tauri/Cargo.toml`

- Les crates `objc2`, `block2`, `objc2-foundation`, `objc2-app-kit`,
  `objc2-web-kit`, `objc2-user-notifications` ne compilent pas sous Windows :
  les déplacer dans `[target.'cfg(target_os = "macos")'.dependencies]`.
- Ajouter pour Windows, dans `[target.'cfg(windows)'.dependencies]` :
  - `webview2-com` et `windows` (accès à WebView2 pour le PDF et l'auto-test).
    **Prendre exactement les versions déjà tirées par `wry`** (`cargo tree -i
    webview2-com` après un premier `cargo build`), sinon deux versions
    incompatibles des types COM coexistent.
  - `tauri-plugin-dialog` (panneaux Enregistrer/Ouvrir, alertes),
    `tauri-plugin-notification`, `tauri-plugin-opener` (ouvrir, montrer dans
    l'Explorateur, ouvrir une URL), `trash` (corbeille). Ces plugins marchent
    aussi sur Mac, mais **on ne change pas la version macOS** : seulement côté
    Windows.
- Les features `macos-private-api` et `devtools` de `tauri` peuvent rester.

### `src-tauri/tauri.conf.json` et icônes

- `tauri-build` exige `src-tauri/icons/icon.ico` sous Windows (ressource de
  l'exécutable). Le générer depuis `icon.png` (`npx @tauri-apps/cli icon
  src-tauri/icons/icon.png`, ou Pillow) et l'ajouter à `bundle.icon`.
- `identifier` : `com.example.sablier`, à garder.

### `src-tauri/src/main.rs`

| Endroit | Sur Mac | Sous Windows |
|---|---|---|
| `accueil()`, `documents()`, `racine` dans `main()` | `$HOME/Library/Application Support/Sablier`, `$HOME/Documents` | `HOME` n'existe pas. Données : `%APPDATA%\Sablier\Donnees` (`std::env::var_os("APPDATA")`), préférences `%APPDATA%\Sablier\preferences.json`. Documents : `app.path().document_dir()` dans les commandes. |
| `ouvrir()` | `/usr/bin/open` et `open -R` | `tauri-plugin-opener` : `open_path`, `reveal_item_in_dir`, `open_url` (ou `explorer` et `explorer /select,<chemin>`). |
| `creer_fenetre()` | `title_bar_style(Overlay)`, `hidden_title`, `traffic_light_position`, `transparent` + `Effect::Sidebar`, URL `index.html?vibrance=1` | Ces méthodes n'existent que sur macOS (erreur de compilation) : `cfg`. Sous Windows, barre de titre normale, fenêtre opaque, URL `index.html` **sans** `?vibrance=1` (la page garde alors son fond). |
| Fermeture de la fenêtre | cachée, l'app reste dans le Dock (`CloseRequested` → `hide`) | Sans Dock, une fenêtre cachée laisse un processus invisible : à la fermeture, appeler `quitter(app)` (vide la page, purge les écritures, quitte). |
| `RunEvent::Reopen` | clic sur le Dock | n'existe que sur macOS : `cfg`. |
| `menu()` | menu d'application « Sablier » (À propos, Masquer, Masquer les autres, Tout afficher), `set_as_windows_menu_for_nsapp` | `hide`, `hide_others`, `show_all` n'ont pas d'effet sous Windows : les retirer ; `set_as_windows_menu_for_nsapp` n'existe que sur macOS. Les raccourcis `CmdOrCtrl+…` deviennent Ctrl+… tout seuls. |
| `rappels_badge` / `pastille` | pastille du Dock | pas de Dock : ne rien faire (ou icône superposée de la barre des tâches, facultatif). |
| `dans_bundle()` | sert à n'activer les notifications que dans un `.app` | sans objet. |

### Protocoles internes (le piège principal)

Le fond sert deux protocoles : `sablier` (les données et `window.sablier` au
chargement de la page) et `sablier-piece` (les images jointes aux tâches).
**Sous Windows, WebView2 ne connaît pas ces schémas** : Tauri les expose en
`http://<schéma>.localhost/<chemin>`.

- `index.html` charge `sablier://localhost/demarrage.js` avant les scripts de
  la page. Sous Windows il faut `http://sablier.localhost/demarrage.js`. Le
  plus simple : `src-tauri/build.rs` recopie déjà `index.html` dans `dist/` ;
  il peut y remplacer `sablier://localhost/` par `http://sablier.localhost/`
  quand `CARGO_CFG_TARGET_OS` vaut `windows`. Le CSP de `index.html`
  (balise `meta`) doit alors autoriser `http://sablier.localhost` dans
  `script-src` et `http://sablier-piece.localhost` dans `img-src`.
- `js/pont.js`, `pieces.url()` : rend `sablier-piece://pieces/<chemin>`. Sous
  Windows (page servie par `http://tauri.localhost`), rendre
  `http://sablier-piece.localhost/pieces/<chemin>`. Mettre aussi
  `plateforme` à la bonne valeur (le fond peut la passer dans
  `__SABLIER_DEMARRAGE`).
- `servir_piece()` (main.rs) : sur Mac l'hôte est `pieces` et le chemin
  `/<tâche>/<fichier>` ; sous Windows l'hôte est le schéma et le chemin
  commence par `/pieces/`. Retirer ce préfixe avant `chemin_dans`.
- `tests/scenario-smoke.js`, clé `imageUrl` : accepter les deux formes d'URL.

L'IPC de Tauri passe déjà par `http://ipc.localhost` sous Windows ; le CSP
l'autorise.

### `src-tauri/src/windows.rs` (à écrire)

- **Panneaux et alertes** : `tauri-plugin-dialog`, appels `blocking_*` (les
  commandes qui les utilisent sont déjà `async`, donc hors du thread
  principal). `alerte` rend l'indice du bouton : `MessageDialogButtons::OkCancelCustom`
  rend `true` pour le premier bouton.
- **Notifications** : `tauri-plugin-notification`. Le clic sur une
  notification (qui ouvre les rappels sur Mac) n'est pas géré par le plugin
  sous Windows ; acceptable. Sans installateur, les toasts s'affichent sous
  le nom de PowerShell : c'est normal en développement.
- **Corbeille** : `trash::delete(chemin)`.
- **PDF** : voir la section suivante.
- **Auto-test** (`executer`, `capturer`, `fantome`) : voir plus bas.

### Les PDF : `imprimer_pdf`

Sur Mac, `mac.rs` rend le HTML (relevé, facture) dans une fenêtre cachée et
l'imprime avec WebKit. Deux corrections y sont **propres à WebKit** et ne
doivent **pas** être reprises sous Windows :

- le zoom `0.75 / 0.8` (WebKit imprime 1 px CSS pour 0,8 pt, Chromium pour
  0,75 pt) ;
- `src-tauri/src/paginer.js` (WebKit coupe les lignes de tableau entre deux
  pages et ne répète pas l'en-tête ; Chromium le fait tout seul grâce au CSS
  des gabarits).

WebView2, c'est Chromium : les PDF seront ceux de l'ancienne version
Electron. La méthode :

1. Fenêtre cachée (`WebviewWindowBuilder`, `visible(false)`), sans IPC.
2. Charger le HTML. `NavigateToString` est limité à 2 Mo : un long relevé
   peut dépasser ; écrire plutôt le HTML dans un fichier temporaire et y
   naviguer, ou le servir par un protocole interne.
3. Attendre que la page soit chargée et `document.fonts.ready`.
4. `with_webview` → `controller().CoreWebView2()` → `cast::<ICoreWebView2_7>()`
   → `PrintToPdf(chemin, réglages, PrintToPdfCompletedHandler)`. Les réglages
   viennent de `ICoreWebView2Environment6::CreatePrintSettings` (environnement
   par `ICoreWebView2_2::Environment`) : page A4 en pouces
   (8,2677 × 11,6929), `ShouldPrintBackgrounds = true`,
   `ShouldPrintHeaderAndFooter = false`. Les marges sont celles du `@page` des
   gabarits (16 mm en haut, 15 mm sur les côtés, 18 mm en bas) : vérifier sur
   le PDF qu'elles ne s'ajoutent pas à celles des réglages (sinon mettre ces
   dernières à 0, ou aux valeurs du `@page`).
5. Attendre le rappel, fermer la fenêtre, rendre `Ok(())` ou le message
   d'erreur.

**Polices** : les gabarits demandent Avenir Next et Charter, absentes de
Windows. Le CSS retombe sur Arial et Georgia ; c'est lisible. Ajouter
« Segoe UI » avant Arial dans `styleDocument()` (`js/gabarits.js`) si le
rendu doit être plus proche.

**Référence** : `docs/reference/facture-2026-02.pdf` et
`docs/reference/releve-2026-08.pdf` sont les PDF de la version Mac pour le
jeu de démonstration (`node outils/jeu-demo.js <dossier>`). Les PDF Windows
doivent avoir le même nombre de pages (2 et 2), les mêmes lignes en tête de
chaque page, aucune ligne de tableau coupée, l'en-tête du tableau répété, le
format A4. Seule la police peut différer.

### `src-tauri/src/donnees.rs` (tests)

Le code est portable (`File::sync_all` = `FlushFileBuffers`, `fs::rename`
remplace la cible sous Windows). Mais **les tests simulent un disque plein
en passant le dossier en lecture seule** (`std::os::unix::fs::PermissionsExt`,
mode `0o555`). Ça ne compile pas sous Windows, et un dossier en lecture
seule n'y empêche pas d'écrire. Remplacer la panne par un moyen portable :
créer un **dossier** à la place de chaque `<nom>.json.tmp`
(`fs::create_dir`) ; `File::create` échoue alors sur les deux systèmes.
`retablir` retire ces dossiers. Les assertions restent les mêmes.

### `src-tauri/src/fichiers.rs`

`nettoyer_nom_fichier` retire déjà `/ \ :` et les caractères de contrôle.
Windows refuse aussi `< > " | ? *`, les noms finissant par un point ou une
espace, et les noms réservés (`CON`, `PRN`, `AUX`, `NUL`, `COM1`…`COM9`,
`LPT1`…`LPT9`, avec ou sans extension). Les ajouter (pour Windows
seulement, ou partout : c'est sans risque sur Mac), avec un test.

### `src-tauri/src/autotest.rs` et l'auto-test

L'auto-test (`SABLIER_SMOKE=1`) joue la vraie app dans une fenêtre
invisible : captures des pages, `tests/scenario-smoke.js` (88 contrôles),
`tests/scenario-audit.js` (60 avec le jeu de démonstration), les deux PDF,
et les erreurs de console. Il dépend de trois fonctions de `mac.rs` :

- `executer(fenêtre, corps)` : exécute un **corps de fonction async** dans
  la page et rend sa valeur. Sous WebView2, `ExecuteScript` n'attend pas les
  promesses ; utiliser `CallDevToolsProtocolMethod("Runtime.evaluate", …)`
  avec `awaitPromise: true` et `returnByValue: true`, sur
  `(async function () { <corps> })()`, puis lire `result.value`.
- `capturer` : `CallDevToolsProtocolMethod("Page.captureScreenshot")` rend
  un PNG en base64.
- `fantome` : sur Mac, la fenêtre est montrée mais transparente, car une
  fenêtre cachée gèle les minuteries. WebView2 ralentit aussi une fenêtre
  cachée : montrer la fenêtre hors de l'écran (position négative) ou laisser
  `controller().SetIsVisible(true)`.

`npm run smoke` utilise la syntaxe POSIX des variables d'environnement. Sous
PowerShell :

```powershell
node outils/jeu-demo.js "$env:TEMP\sablier-test"
$env:SABLIER_SMOKE='1'; $env:SABLIER_SMOKE_SCENARIO='1'; $env:SABLIER_SMOKE_AUDIT='1'; $env:SABLIER_SMOKE_PDF='1'
$env:SABLIER_DONNEES="$env:TEMP\sablier-test"; $env:SABLIER_CAPTURES="$env:TEMP\sablier-captures"
cargo run --manifest-path src-tauri/Cargo.toml
```

Rendre `npm run smoke` portable (petit script Node qui pose les variables)
est bienvenu.

### Construction et installation

`scripts/installer.js` est propre au Mac (`codesign`, `ditto`,
`/Applications`, `SetFile`, `osascript`). Sous Windows :

- `cargo build --release --manifest-path src-tauri/Cargo.toml` produit
  `src-tauri/target/release/sablier.exe`, autonome (la page est embarquée ;
  WebView2 est fourni par Windows). C'est suffisant pour l'utiliser.
- Pour un installateur : `npm i -D @tauri-apps/cli`, `bundle.active: true`,
  `targets: ["nsis"]`, puis `npx tauri build`.
- Garder l'esprit de l'installateur Mac : tests, puis auto-test sur le
  binaire construit, et seulement ensuite installation.

### Interface

- Les raccourcis clavier acceptent déjà Ctrl comme ⌘ (`metaKey || ctrlKey`
  partout).
- Les textes affichent « ⌘ » à une trentaine d'endroits (`index.html`,
  `js/page-notes.js`, `js/page-journal.js`, `js/page-taches.js`). Facultatif :
  les afficher en « Ctrl+ » sous Windows (une fonction qui remplace selon
  `window.sablier.plateforme`).
- La police de l'interface finit par `system-ui` : Segoe UI sous Windows,
  rien à faire.
- Sans `?vibrance=1`, la page garde son fond opaque : rien à faire. La marge
  du haut de la barre latérale, prévue pour les boutons de fenêtre du Mac,
  peut être réduite sous Windows (cosmétique).

## Ordre conseillé

1. `Cargo.toml` (dépendances par système) et `icon.ico`, puis
   `cargo build` jusqu'à ce que ça compile, avec un `windows.rs` dont les
   fonctions rendent d'abord une erreur claire.
2. Chemins (`APPDATA`, Documents), fenêtre, menus, fermeture.
3. Protocoles (`build.rs`, `pont.js`, `servir_piece`) : la page doit
   démarrer avec les données (`window.sablier` défini, aucune erreur de
   console).
4. Tests de `donnees.rs` rendus portables : `npm test` vert.
5. `executer`, `capturer`, `fantome` : l'auto-test tourne.
6. Panneaux, alertes, notifications, corbeille, ouverture.
7. PDF, comparés aux références.
8. `nettoyer_nom_fichier` pour les noms Windows.

## Quand c'est fini

- [ ] `npm test` : 57 tests JS et tous les tests Rust verts sous Windows.
- [ ] Auto-test complet sur le jeu de démonstration : `SABLIER_SMOKE_OK`,
      88 contrôles du scénario et 60 de l'audit à `true`, aucune ligne
      `SABLIER_CONSOLE`.
- [ ] PDF du relevé et de la facture conformes aux références (pages,
      débuts de page, lignes entières, en-tête répété, A4, marges).
- [ ] À la main : enregistrer un PDF, exporter et importer une sauvegarde,
      choisir le dossier des factures (les PDF de facture s'y rangent dans
      un sous-dossier du mois), joindre un fichier par le bouton puis en le
      glissant depuis l'Explorateur, l'ouvrir et le retirer (il va dans la
      corbeille), recevoir une notification de rappel, fermer la fenêtre
      puis relancer : rien n'est perdu.
- [ ] Les données sont dans `%APPDATA%\Sablier\Donnees`, une copie datée
      par jour dans `Sauvegardes`.
- [ ] Sur Mac, rien n'a changé (si un Mac est disponible : `npm test` et
      l'auto-test y passent toujours).
