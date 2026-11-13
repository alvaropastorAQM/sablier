# Sablier

Suivi de mission pour indépendant : journal du temps, relevé mensuel et
facture en PDF, tâches, notes, échéances, rappels. Interface en HTML/CSS/JS
sans framework (`index.html`, `js/`, `css/`), fond en Rust avec Tauri 2
(`src-tauri/`). Le README décrit chaque page, les règles de calcul et
l'organisation du code.

**Sous Windows : lire `docs/MIGRATION-WINDOWS.md` avant toute chose.** L'app
est aujourd'hui macOS seulement (`src-tauri/src/mac.rs` appelle AppKit et
WebKit) ; ce guide dit quoi porter, dans quel ordre, et comment vérifier.

## Commandes

```bash
npm test         # moteur de calcul (node) puis fond Rust (cargo test)
npm start        # lance l'app (sur les vraies données de l'utilisateur)
npm run smoke    # auto-test sur un dossier jetable (syntaxe POSIX)
```

L'auto-test complet et ses variables (`SABLIER_SMOKE_*`) sont décrits dans
le README et en tête de `src-tauri/src/autotest.rs`. Il ne tourne jamais sur
les vraies données (refusé sans `SABLIER_DONNEES`).

## Règles

- Identifiants, commentaires et textes en français.
- Aucun tiret cadratin dans les textes de l'interface ; toute couleur passe
  par les tokens de `css/styles.css`.
- Le format des fichiers de données ne change pas : `donnees.rs` écrit comme
  `JSON.stringify(objet, null, 2) + '\n'`.
- Un changement se vérifie par `npm test` et par l'auto-test ; on ne retire
  pas un test pour le faire passer.
