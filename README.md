# Sablier

Application macOS de suivi de mission : le temps passé pour un client,
le relevé d'activité mensuel et la facture qui l'accompagne, les tâches,
les notes, le calendrier administratif de la micro-entreprise et les
rappels qui vont avec.

Design « Graphite » (`design/design_system_macos27.md`) depuis le 25/10/2026 : neutres froids, accent bleu acier, verre de macOS, sombre et clair selon le Mac ; les PDF ont leur propre charte (blanc, marine, or, titres serif) ; l'interface
en HTML/CSS/JS sans framework, données en fichiers JSON lisibles.

Depuis le 13/11/2026, l'application tourne sous Tauri (fond en Rust,
`src-tauri/`) et non plus sous Electron : 12 Mo au lieu de 280. L'interface
n'a pas changé ; elle parle au fond par `window.sablier` (`js/pont.js`).
Mêmes données, même dossier, même format de fichiers, mêmes PDF (WebKit
imprime à la place de Chromium : un petit script, `src-tauri/src/paginer.js`,
garde les lignes de tableau entières et répète l'en-tête sur chaque page).

## Lancer et construire

```bash
npm start            # lance l'application en développement (sur les vraies données)
npm test             # tests du moteur de calcul (node) et du fond Rust (données, fichiers)
npm run smoke        # auto-test sur /tmp/sablier-smoke, jamais sur les vraies données
npm run app:build    # tests, construction de release/Sablier.app, auto-test complet, puis installation dans /Applications
```

Il faut Node.js, Rust et les outils Xcode ; aucune dépendance npm.
L'application se lance depuis `/Applications/Sablier.app` (Dock, Spotlight).
Chaque construction y est recopiée automatiquement, seulement si elle passe
l'auto-test, après avoir demandé à Sablier ouvert de quitter : une copie
ancienne dans /Applications ferait revenir des défauts déjà corrigés.

Auto-test complet, sur un dossier de données jetable (jamais sur le vrai) :

```bash
SABLIER_SMOKE=1 SABLIER_SMOKE_SCENARIO=1 SABLIER_SMOKE_AUDIT=1 SABLIER_SMOKE_PDF=1 SABLIER_DONNEES=/tmp/sablier-test SABLIER_CAPTURES=/tmp/sablier-test cargo run --manifest-path src-tauri/Cargo.toml
```

Il tourne même quand Sablier est ouvert, dans une fenêtre invisible, et
quitte avec 0 si tout est vrai (`SABLIER_SMOKE_OK`), 1 sinon
(`SABLIER_SMOKE_ECHEC` et la liste). Les scénarios sont dans
`tests/scenario-smoke.js` et `tests/scenario-audit.js`. Écran verrouillé ou
en veille, WebKit ne rend pas les captures : elles sont signalées, pas
comptées comme des échecs.

Format des fichiers, vérifié sur une copie des vraies données (relus puis
réécrits, ils ressortent à l'octet près) :

```bash
SABLIER_VERIF=<copie du dossier Donnees> cargo test --manifest-path src-tauri/Cargo.toml -- --ignored
```

## Ce que fait chaque page

| Page | Rôle |
|---|---|
| Rappels (bouton de la barre latérale, ⌘⇧R) | Tout ce qu'il ne faut pas rater : échéances, tâches datées, mois à facturer, factures à encaisser, chrono oublié, journal délaissé ; report à demain ou à sept jours, marquer fait |
| Tableau de bord | Rappels du moment, heures facturables et montant facturable de la période, gagné depuis le début (factures émises, part encaissée), à garder pour l'URSSAF et date du prochain prélèvement (depuis le 27/10/2026), heures par mois, répartition par axe, tâches et échéances à venir |
| Journal et relevé | Le travail du mois de facturation jour par jour (interventions, temps facturé, montant, état), une journée se déplie sur ses lignes de journal (modifier, dupliquer, supprimer, reprendre au chrono) ; « Ajouter une ligne » (⌘N) ; dans la fiche d'une ligne : tâche liée et mois de facturation ; report d'interventions sur un autre mois ; établissement de la facture, qui enregistre d'office la facture et le relevé PDF dans le dossier des factures (Réglages), sous-dossier « AAAA-MM mois » ; une fois tout facturé, les boutons sans objet disparaissent. Les factures émises, le livre des recettes et les trimestres URSSAF ont leur propre onglet, « Factures et recettes » (depuis le 27/10/2026). Chrono : barre latérale et bandeau (plus de saisie rapide depuis le 27/10/2026) |
| Tâches | Tableau À faire / En cours / Fait, glisser-déposer, fiche complète (étapes, pièces jointes, notes liées, journal d'avancement, temps passé), chrono depuis une carte |
| Notes | Pages et sous-pages, éditeur continu façon Notes d'Apple (barre de mise en forme, menu « / », raccourcis Markdown et clavier, collage toujours en texte brut, annuler et rétablir), idées transformables en tâche, recherche dans le contenu, bande des tâches liées |
| Échéances | Calendrier administratif (ACRE, CFE, URSSAF, vigilance, bilan) et rappels, chacun avec son délai de rappel |
| Réglages | Tarif, arrondi, identités, coordonnées bancaires, axes, cotisations, rappels et notifications, sauvegardes |

## Règles de calcul

- Une **intervention** = même jour + même axe + même libellé. Ses lignes
  s'additionnent ; elle compte pour son temps exact.
- Le **temps facturé** est le total exact du relevé ou de la facture,
  arrondi une seule fois au quart d'heure supérieur (article 6.1 du
  contrat), réglable dans Réglages. Depuis le 26/10/2026 (règle du
  prestataire) : l'arrondi par intervention faisait payer près de deux heures
  de trop par mois. L'arrondi apparaît sur sa propre ligne (« Arrondi du
  total au quart d'heure supérieur ») au relevé et dans l'annexe de la
  facture ; la facture le fige (`arrondiMinutes`). Les forfaits restent
  hors du total arrondi.
- **Montant** = heures facturées x tarif horaire ; pas de TVA (franchise).
- Une ligne peut être **non facturable** (le temps reste compté, le montant
  vaut 0 €, avec un motif) ou porter un **forfait** (montant HT fixe qui
  remplace heures × tarif ; la valeur au tarif horaire et la remise restent
  visibles sur le relevé et la facture).
- Une **facture** fige les lignes pas encore facturées du mois : un mois
  peut donc porter plusieurs factures (par exemple une facture en cours de
  mois, puis celle du solde à la fin). Numérotation continue
  par année (AAAA-NN, l'année étant celle de la date d'émission) : seul le
  numéro suivant est accepté, et la date ne précède jamais celle de la facture
  précédente. La facture fige aussi le prestataire et le client ; le relevé
  d'un mois facturé reste celui de l'émission, et « Refaire les PDF » ajoute
  une copie (`Facture-2026-01 (2).pdf`) sans écraser les PDF existants. Seule
  la dernière facture peut être supprimée, et jamais une fois encaissée. Une
  ligne figée sur une facture ne
  change plus de date, d'axe, de durée, de mois de facturation ni de
  facturation (seuls le libellé
  et le détail restent modifiables) et ne se supprime pas tant que la
  facture existe ; le reste d'une intervention facturée en partie part au
  temps exact sur la facture suivante, qui arrondit son propre total. Le
  délai de paiement
  est figé sur la facture.
- **Mois de facturation** : une ligne se facture par défaut sur le mois de
  sa date, mais peut être **reportée** sur un mois ultérieur (champ de la
  fiche, ou bouton « Reporter sur un autre mois » du relevé). Le journal, le
  tableau de bord et les pastilles restent sur le mois du travail ; le
  relevé, la facture et le rappel « mois à facturer » suivent le mois de
  facturation. Un report emporte toujours l'intervention entière ; les lignes qu'une
  facture a figées ne se reportent plus. Le relevé de départ et celui
  d'arrivée l'annoncent chacun d'un bandeau, et la ligne porte la mention
  « Réalisé en septembre 2026 » à l'écran comme sur le PDF du relevé. La
  **facture**, elle, ne dit pas quand le travail a été réalisé : ni date, ni
  mois d'origine, et son annexe regroupe les interventions par axe et
  libellé (une ligne par intervention, temps et montants additionnés) ; le
  journal, le relevé et les lignes figées de la facture gardent la date. Si une
  intervention se retrouve malgré tout à cheval sur deux mois (fichier
  modifié à la main, import), le chargement réaligne ses lignes sur un seul
  mois.
- **Arrondis** : les montants d'une intervention restent exacts (comme les
  cellules du classeur) ; seuls les totaux et l'affichage sont arrondis au
  centime (arrondi commercial), si bien que « heures facturées × tarif »
  tombe juste sur la facture.
- **Durées** : la durée tapée prime ; début et fin ne servent qu'à la
  pré-remplir. Des heures qui donneraient plus de seize heures (fin avant
  début) sont refusées. Un chrono arrêté pendant une pause se termine au
  début de la pause.
- **Documents PDF** : en tête, seules les mentions utiles (nom suivi de
  « EI », adresse sur deux lignes, SIRET, contact). La facture (refaite le
  26/10/2026) : émetteur à gauche, numéro, date d'émission et échéance à
  droite, client décalé, désignation, « Total TTC à payer », mention de
  franchise, puis « Conditions de règlement » (échéance, escompte néant,
  pénalités de retard et indemnité de 40 €, toujours imprimées car
  obligatoires entre professionnels ; titulaire, banque, IBAN par groupes de
  quatre, BIC). Son annexe regroupe les interventions par axe, avec
  sous-totaux, sans date (le relevé d'activité daté se joint à part).
- `outils/importer-git.js` reconstitue des sessions de travail depuis
  l'historique d'un dépôt git et les verse dans le journal (aperçu par
  défaut, `--appliquer` pour écrire, `--coefficient 0.6` pour pondérer). Il
  refuse d'écrire si une ligne de la source est portée par une facture, et
  conserve les annotations manuelles (non facturable et son motif, forfait,
  mois de facturation) en les rattachant au travail, pas au numéro de
  session ; celles qui ne retrouvent pas leur travail sont signalées.
- Les **cotisations** sont estimées sur le chiffre d'affaires encaissé, au
  taux ACRE jusqu'à sa date de fin puis au taux plein.
- Un mois écoulé du contrat est réclamé par les **rappels** dès qu'il reste
  quelque chose à facturer, frais de déplacement compris.
- Les **tâches** se rangent d'elles-mêmes dans chaque colonne : priorité
  haute, puis moyenne, puis basse, et à priorité égale l'échéance la plus
  proche en premier. La priorité effective est la plus haute entre le choix
  manuel et celle dictée par l'échéance (moins de 5 jours : haute ; jusqu'à
  14 jours : moyenne ; au-delà : basse). Un choix manuel n'est jamais abaissé.
- Les **idées** vivent dans les notes (page « Idées en vrac », style
  « Idée ») ; « En faire une tâche » crée la tâche dans À faire, liée à la
  page. Les anciennes cartes « Idées » ont été migrées vers cette page.
- L'**éditeur de notes** (`js/page-notes.js`) est une seule zone
  `contenteditable` : une ligne à l'écran = un bloc dans `notes.json`
  (`{id, type, html, coche, tache, retrait}`, format inchangé). Entrée, retour
  arrière, collage et annuler sont gérés par l'éditeur ; après chaque
  modification native, `normaliserDoc` remet les lignes en ordre. Le texte
  collé ou déposé est toujours inséré en texte brut.
- Les **rappels** (`calculerRappels` dans `js/calculs.js`) ont trois
  niveaux : en retard, aujourd'hui, bientôt. Horizons réglables ; chaque
  échéance peut avoir le sien. Notifications macOS : une par jour pour les
  retards et rappels du jour, une à l'entrée dans l'horizon (puis une par
  semaine) pour « bientôt » ; regroupées quand il y en a plusieurs. Pastille
  du Dock : retards et rappels du jour.
- Chaque **axe** a une couleur (Réglages), reprise sur les cartes, le journal,
  le relevé et les factures.

## Données

Audit complet (02/09/2026) : `tests/scenario-audit.js` rejoue les cas
limites dans l'auto-test (`SABLIER_SMOKE_AUDIT=1`) : modales secondaires de
la fiche, suppressions en cascade, chrono passant minuit, sauvegarde
ancienne importée, numéro de facture, intervention facturée en partie,
report sur un autre mois de facturation, champs vidés, pages sans données,
glisser annulé. Au chargement, les
fichiers sont assainis (éléments nuls écartés, identifiants manquants
attribués, nombres en chaîne convertis, mois de facturation mal écrit
ramené au mois du travail, lignes d'une même intervention réalignées sur un
seul mois de facturation) ; un fichier illisible est mis de
côté et signalé ; les écritures en attente sont purgées avant toute
relecture ou fermeture.

`~/Library/Application Support/Sablier/Donnees/` : `reglages.json`,
`journal.json`, `chantiers.json` (les tâches, nom historique), `notes.json`,
`factures.json`, `echeances.json`, `chrono.json`. Une copie datée est faite
dans `Sauvegardes/` une fois par jour, même si l'application reste ouverte
(30 conservées). Une écriture refusée par le disque est retentée toutes les
30 secondes, l'alerte revient toutes les 5 minutes, et Sablier prévient avant
de quitter si des données ne sont toujours pas écrites.
Les fichiers joints aux tâches sont copiés dans `Pieces/<tâche>/` (servis à
l'interface par le protocole interne `sablier-piece://`) ; ils ne font pas
partie de l'export JSON. Export et import d'une sauvegarde complète depuis
Réglages.

Pour travailler sur un jeu d'essai sans toucher aux vraies données :

```bash
node outils/jeu-demo.js /tmp/sablier-demo && SABLIER_DONNEES=/tmp/sablier-demo npm start
```

## Organisation du code

```
index.html            la coquille : barre latérale, pages, réglages, mode d'emploi
css/styles.css        tokens et composants (design Graphite)
js/bulle.js           bulle Liquid Glass de la sélection
js/utils.js           dates, durées, formats (IBAN, téléphone, adresse, J-n)
js/calculs.js         moteur : regroupement, arrondi, relevé, factures, trimestres, priorités, rappels
js/donnees.js         état, persistance, valeurs de départ, migrations
js/graphique.js       barres SVG
js/ui.js              navigation, notifications, modales, menus, icônes
js/gabarits.js        documents PDF (relevé, facture)
js/rappels.js         centre des rappels, notifications macOS, pastille du Dock
js/page-*.js          une page par fichier (page-factures.js est une vue de page-releve.js)
js/app.js             démarrage
js/pont.js            window.sablier, servi par le fond avec les données (sablier://localhost/demarrage.js)
src-tauri/src/main.rs         fenêtre, menus, commandes du pont, protocoles (données, pièces jointes)
src-tauri/src/donnees.rs      fichiers JSON, écritures différées et retentées, sauvegardes quotidiennes
src-tauri/src/fichiers.rs     noms sûrs, pièces jointes, noms libres des PDF
src-tauri/src/mac.rs          AppKit et WebKit : PDF, panneaux, alertes, notifications, Dock, corbeille
src-tauri/src/paginer.js      sauts de page des PDF, joués avant l'impression
src-tauri/src/autotest.rs     auto-test (SABLIER_SMOKE=1)
scripts/installer.js  construction, vérification et installation de Sablier.app
outils/               icône, jeu de démonstration, import git
tests/                tests node du moteur, scénarios de l'auto-test
```

Règle de style permanente : aucun tiret cadratin dans les textes de
l'interface ; toute couleur passe par les tokens de `css/styles.css`.
