# DESIGN SYSTEM: "GRAPHITE" · ARC × macOS 27 HYBRID

> **Drop this at the root (or in `design/`) of every project.** Every interface, view or component generated in this project applies this document. It describes a single visual language for all my apps: the material and depth of macOS 27 (glass, light, concentric radii), the framing of Arc (content inset in the window), and a professional restraint with colour.
>
> **The only thing to customise per project:** section 0.3 (accent colour, name, icon). Everything else is shared.

---

## 0. PRINCIPLES

### 0.1 The five rules that override everything else

1. **Colour is information, not decoration.** The interface is graphite (cool neutrals) for more than 90%. One accent colour per app. Every use of colour must answer "what does this signal?".
2. **Depth comes from material, not from colour.** Frosted glass, soft shadows, a 1 px specular rim on top of surfaces. Never a coloured halo under a card, never a multicolour gradient.
3. **Native first.** If the platform provides the component (SwiftUI, AppKit), use it and tune it; do not redraw it. The CSS specs below are for web apps and serve as a visual reference for native (see section 8).
4. **Numbers first.** These are work tools: clear hierarchy, controlled density, figures in `tabular-nums`, no decoration that competes with the data.
5. **Two appearances on equal footing.** Light and dark are designed together; dark is the reference appearance of the mockups, not the only one.

### 0.2 Colour budget (to respect on screen, not only in code)

| Use | Allowed colour |
| --- | --- |
| Backgrounds, cards, borders, text, navigation icons | Neutrals only |
| Active navigation item | Neutral background + **icon** in accent (the text stays neutral) |
| Primary button, focus, enabled switch, link, row selection | Accent |
| Main series or highlighted value of a chart | Accent; the other series in neutrals |
| Categorical data (categories, models, families) | Muted categorical palette, 6 hues max + "Other" in grey |
| States (success, warning, error) | Semantic colours, only for a real state |
| "Featured" card (one per screen at most) | Accent-tinted top rim |
| Ambient light | One very faint accent halo under the sidebar, nothing in the content |

**Visual check:** on a screenshot, the accent covers less than 5% of the surface. If you notice it before the numbers, there is too much.

**Forbidden:** rims of different colours per card, coloured `box-shadow` (glow), gradient text, saturated mesh gradients, card backgrounds tinted by category, more than two non-neutral hues in the same component outside a categorical chart.

### 0.3 Per-project customisation

```css
:root {
  --accent-h: 220;    /* Sablier: steel blue #5B8DEF (amber was confused with the orange of the alerts) */
  --accent-s: 82%;
  --accent-l: 65%;    /* in dark; the light version is derived further down */
}
```

Suggested accents (one per app, chosen for its identity, never two):
terracotta `#D97757` · steel blue `#5B8DEF` · sage green `#5FA37A` · amber `#D9A04A` · slate violet `#8B7FD1` · pure graphite (no accent, selection in white) for very sober tools.

"Voice" option: an editorial app can use **New York** (the system serif) for page titles only. Everything else stays in SF Pro. Open replacement bundled in `css/fonts` (used where the Apple fonts are not available, such as on Linux and in the PDFs): Charter for New York.

---

## 1. SPATIAL ARCHITECTURE (ARC + macOS DNA)

The app behaves like a macOS 27 window, not like a web page.

1. **Window (App Shell)**
   - `display: flex; height: 100vh; overflow: hidden;`
   - On the web: window corners `--radius-window: 22px` (when the window is simulated in a mockup or in a frameless Electron/Tauri app).
   - Traffic lights: `12px` in diameter, spaced `8px` apart, at the top left of the sidebar (`top: 18px; left: 18px`). System colours `#FF5F57`, `#FEBC2E`, `#28C840` with an inner ring `inset 0 0 0 0.5px rgba(0,0,0,0.2)`. Inactive window: all three in `rgba(255,255,255,0.14)` (dark) / `rgba(0,0,0,0.12)` (light).
   - Native: **never draw them**, use the system ones (see section 8).

2. **Spaces rail (optional, multi-context apps only)**
   - Vertical rail of `52px` to the left of the sidebar, icons `32×32px`, `border-radius: 9px`.
   - **Monochrome** icons on a neutral `--fill-1` background; the active space has a `--fill-3` background and a `4px` accent dot on the left. No gradients.

3. **Sidebar (glass)**
   - `width: 240px` (resizable `200-280px`), transparent: it lets the window material show through (the blurred wallpaper).
   - Material: `background: var(--glass-sidebar); backdrop-filter: blur(48px) saturate(140%);`
   - Header: app name (`15px`, `600`) + app icon `20px`.
   - Group titles: `11px`, `600`, `var(--text-tertiary)`, `padding: 14px 10px 4px`.
   - Items: `height: 30px; padding: 0 10px; border-radius: 8px; gap: 10px;` icon `16px` in `--text-secondary`, text `13px` in `--text-secondary`.
   - Hover: `var(--fill-1)` background.
   - Active: the **Liquid Glass bubble** of section 5.I (a single one for the whole list, sliding from item to item), text `--text-primary` at `500`, **icon in accent**. The items have no active background of their own.

4. **Inset Main Stage: the Arc signature**
   - Outer margin `margin: 8px 8px 8px 0` (`--stage-inset`).
   - **Concentric radii** (macOS 27 rule): `inner radius = outer radius − margin`. Window `22px` − `8px` → stage `14px`.
   - Background: `var(--bg-stage)` (nearly opaque: legibility beats transparency).
   - Outline: `box-shadow: 0 0 0 1px var(--border-subtle), var(--specular-top), 0 12px 40px rgba(0,0,0,0.35);`
   - Only the stage scrolls (`overflow-y: auto`); the sidebar and the toolbar stay fixed.

5. **Stage toolbar**
   - `position: sticky; top: 0; z-index: 40; height: 52px; padding: 0 16px;`
   - Material: `background: var(--glass-toolbar); backdrop-filter: blur(24px) saturate(160%);` + a `1px var(--border-subtle)` bottom rule that only appears once the content has scrolled.
   - Left: `‹ ›` arrows (`28×28px` buttons, `border-radius: 8px`), then the page title (`15px`, `600`) once the header has scrolled away.
   - Centre: `⌘K` command bar: `width: 320px; height: 30px; border-radius: 9999px; background: var(--fill-1); border: 1px solid var(--border-subtle);` placeholder in `--text-tertiary`, the `⌘K` shortcut in a `--fill-2` key.
   - Right: the view's global filters (segmented period control, filter menu), then account/settings.

---

## 2. MATERIAL & LIGHT

1. **Ambient light (sober version)**
   - Natively, it comes for free from the wallpaper through the sidebar glass: **add nothing**.
   - On the web: a `--bg-root` window background + **at most two halos** under the sidebar only: `width: 520px; height: 520px; border-radius: 50%; filter: blur(120px); pointer-events: none;`
     - Halo 1 (top left): accent at `opacity: 0.14`.
     - Halo 2 (bottom left): blue-grey `#5A6B85` at `opacity: 0.12`.
   - **No halo in the stage.** The stage is a calm workspace.

2. **Specular rim (1px Specular Rim)**: light comes from above
   - Every raised surface (stage, card, popover, glass button) has a neutral highlight on its top edge: `inset 0 1px 0 0 var(--rim)`.
   - Side and bottom edges: `1px var(--border-subtle)`.
   - Coloured (accent) rim: reserved for **one** featured card per screen, and for the focused element.

3. **Surface levels**

| Level | Role | Dark | Light |
| --- | --- | --- | --- |
| 0 | Window background | `#0B0C0E` | `#E6E7EA` |
| 1 | Stage | `rgba(18,18,21,0.94)` | `rgba(246,246,248,0.94)` |
| 2 | Card | gradient `rgba(255,255,255,0.045) → 0.025` | `#FFFFFF` |
| 3 | Hovered card / active element | gradient `0.07 → 0.04` | `#FFFFFF` + stronger shadow |
| 4 | Popover, menu, ⌘K palette, status module | `rgba(32,32,37,0.78)` + `blur(40px) saturate(160%)` | `rgba(255,255,255,0.80)` + `blur(40px) saturate(180%)` |

Level 4 shadow: `0 24px 64px -12px rgba(0,0,0,0.55), 0 0 0 1px var(--border-subtle), var(--specular-top)`.

---

## 3. REFERENCE CSS TOKENS

```css
:root {
  color-scheme: dark;

  /* Accent (the only value to change per project, see 0.3) */
  --accent-h: 15; --accent-s: 62%; --accent-l: 60%;
  --accent:        hsl(var(--accent-h) var(--accent-s) var(--accent-l));
  --accent-strong: hsl(var(--accent-h) var(--accent-s) calc(var(--accent-l) - 8%));
  --accent-soft:   hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.14);
  --accent-rim:    hsl(var(--accent-h) var(--accent-s) var(--accent-l) / 0.55);
  --on-accent:     #FFFFFF;

  /* Surfaces */
  --bg-root:        #0B0C0E;
  --glass-sidebar:  rgba(28, 29, 33, 0.55);
  --glass-toolbar:  rgba(18, 18, 21, 0.72);
  --bg-stage:       rgba(18, 18, 21, 0.94);
  --surface-card:       linear-gradient(180deg, rgba(255,255,255,0.045) 0%, rgba(255,255,255,0.025) 100%);
  --surface-card-hover: linear-gradient(180deg, rgba(255,255,255,0.07) 0%, rgba(255,255,255,0.04) 100%);
  --surface-floating:   rgba(32, 32, 37, 0.78);

  /* Neutral fills (controls, tracks, hovers) */
  --fill-1: rgba(255,255,255,0.05);
  --fill-2: rgba(255,255,255,0.08);
  --fill-3: rgba(255,255,255,0.11);

  /* Borders & light */
  --border-subtle: rgba(255,255,255,0.07);
  --border-strong: rgba(255,255,255,0.12);
  --rim:           rgba(255,255,255,0.10);
  --specular-top:  inset 0 1px 0 0 var(--rim);
  --shadow-card:   0 1px 2px rgba(0,0,0,0.25), 0 8px 24px -12px rgba(0,0,0,0.5);

  /* Text */
  --text-primary:   rgba(255,255,255,0.94);
  --text-secondary: rgba(255,255,255,0.62);
  --text-tertiary:  rgba(255,255,255,0.40);

  /* Semantic (real states only) */
  --positive: #4CB782; --warning: #E0A443; --negative: #E5675C;

  /* Charts */
  --chart-neutral: rgba(255,255,255,0.26);   /* secondary series, ranking bars */
  --chart-track:   rgba(255,255,255,0.06);   /* tracks, empty cells */
  --chart-grid:    rgba(255,255,255,0.06);
  --cat-1: var(--accent); --cat-2: #7F95B2; --cat-3: #8FA58A;
  --cat-4: #C2AE8C;       --cat-5: #A190B8; --cat-6: #6F7A86;
  --cat-other: rgba(255,255,255,0.20);

  /* Radii (concentric) & spacing */
  --radius-window: 22px;
  --stage-inset:   8px;
  --radius-stage:  14px;   /* = window − inset */
  --radius-card:   12px;
  --radius-inner:  8px;    /* thumbnails, list items, square buttons */
  --radius-pill:   9999px;
  --space-page:    28px;   /* inner margin of the stage */
  --gap-grid:      14px;

  /* Motion */
  --spring-apple:    cubic-bezier(0.22, 1, 0.36, 1);
  --duration-fast:   160ms;
  --duration-normal: 280ms;

  /* Liquid Glass bubble (section 5.I) */
  --spring-bubble:   linear(0, 0.22 7%, 0.62 16%, 0.94 26%, 1.07 34%, 1.09 40%, 1.05 50%, 1 60%, 0.985 70%, 1 85%, 1);
  --duration-bubble: 550ms;   /* slide + bounce until it settles */
  --bubble-stretch:  0.16;    /* drop stretch at the start (+16% along the direction of travel) */
  --bubble-lift:     4px;     /* growth per side when held */
  --lens-scale:      1.2;     /* magnification of the titles under the held bubble */
}

/* Light appearance. To follow the system, duplicate this block inside
   @media (prefers-color-scheme: light) { :root:not([data-theme="dark"]) { … } } */
:root[data-theme="light"] {
  color-scheme: light;
  --accent-l: 52%;
  --on-accent: #FFFFFF;

  --bg-root:        #E6E7EA;
  --glass-sidebar:  rgba(240, 240, 243, 0.62);
  --glass-toolbar:  rgba(246, 246, 248, 0.78);
  --bg-stage:       rgba(246, 246, 248, 0.94);
  --surface-card:       #FFFFFF;
  --surface-card-hover: #FFFFFF;
  --surface-floating:   rgba(255, 255, 255, 0.80);

  --fill-1: rgba(0,0,0,0.04);
  --fill-2: rgba(0,0,0,0.06);
  --fill-3: rgba(0,0,0,0.08);

  --border-subtle: rgba(0,0,0,0.07);
  --border-strong: rgba(0,0,0,0.12);
  --rim:           rgba(255,255,255,0.9);
  --shadow-card:   0 1px 2px rgba(0,0,0,0.04), 0 6px 20px -10px rgba(0,0,0,0.12);

  --text-primary:   rgba(0,0,0,0.88);
  --text-secondary: rgba(0,0,0,0.58);
  --text-tertiary:  rgba(0,0,0,0.38);

  --chart-neutral: rgba(0,0,0,0.22);
  --chart-track:   rgba(0,0,0,0.05);
  --chart-grid:    rgba(0,0,0,0.06);
  --cat-2: #5E7697; --cat-3: #6E8A68; --cat-4: #A8925F; --cat-5: #8371A0; --cat-6: #56606B;
  --cat-other: rgba(0,0,0,0.18);
}
```

---

## 4. TYPOGRAPHY (SF PRO, macOS scale)

- **Font:** `font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Inter", system-ui, sans-serif;` with `-webkit-font-smoothing: antialiased;`.
- **Open replacements bundled in `css/fonts`** (for platforms without the Apple fonts, and for the PDFs): **Inter** replaces SF Pro, **Charter** replaces New York, **JetBrains Mono** replaces SF Mono, and **Nunito Sans** replaces Avenir Next (used in the PDFs).
- **macOS body text = 13 px**, not 14-16 px: this is what makes an app feel "native" rather than like a "website".

| Role | Size | Weight | Letter spacing | Colour |
| --- | --- | --- | --- | --- |
| View title (Large Title) | `28px` | `700` | `-0.022em` | primary |
| Hero (home, recap only) | `34px` | `700` | `-0.025em` | primary |
| Section / card title | `13px` | `600` | `-0.005em` | primary |
| Card subtitle | `12px` | `400` | `0` | tertiary |
| Body | `13px` | `400`, `line-height: 1.45` | `0` | secondary |
| Eyebrow | `11px` | `600`, UPPERCASE | `0.06em` | tertiary |
| Label / caption / badge | `11-12px` | `500` | `0.01em` | tertiary |
| KPI value | `26px` | `600` | `-0.02em` | primary |
| Big number (featured) | `40px` | `600` | `-0.03em` | primary |

- Any numeric data (KPIs, tables, axes, durations): `font-variant-numeric: tabular-nums;`.
- Units smaller than the number (`48 h` → "48" at `26px`, "h" at `17px` secondary).
- No drop shadow on text, except a title placed over an image.

---

## 5. COMPONENTS

### A. View header (replaces the "Apple TV hero")
- By default: optional eyebrow + `28px` view title + one sentence of context (`13px`, secondary, `max-width: 720px`) + actions on the right. `padding: 24px var(--space-page) 20px`.
- **Hero**: reserved for home, recap and onboarding. Background = radial gradient of **the accent alone**, very soft, fading into the stage: `radial-gradient(120% 140% at 0% 0%, var(--accent-soft) 0%, transparent 55%)`. Height `160-220px`. No mesh, no abstract multicolour image.
- Primary button: `background: var(--accent); color: var(--on-accent); height: 30px; padding: 0 14px; border-radius: 8px; font: 500 13px;` + `box-shadow: inset 0 1px 0 rgba(255,255,255,0.22), 0 1px 2px rgba(0,0,0,0.3)`.
- Secondary (glass) button: `background: var(--fill-2); color: var(--text-primary); box-shadow: var(--specular-top), 0 0 0 1px var(--border-subtle);`
- Pill buttons (`9999px`) only in the toolbar and the hero; elsewhere, radius `8px` (macOS style).

### B. Bento grid & cards
- `display: grid; grid-template-columns: repeat(12, 1fr); gap: var(--gap-grid);`: cards span 3, 4, 6, 8 or 12 columns. Fallback `auto-fill, minmax(260px, 1fr)` below `900px`.
- Card: `background: var(--surface-card); border-radius: var(--radius-card); padding: 16px 18px; box-shadow: 0 0 0 1px var(--border-subtle), var(--specular-top), var(--shadow-card);`
- Card header: `14px` icon in `--text-tertiary` + `13px/600` title + `12px` tertiary subtitle; discreet action on the right (segmented control or `…` menu).
- **Featured card** (one per screen max): replace `var(--specular-top)` with `inset 0 1px 0 0 var(--accent-rim)` and add the background `radial-gradient(80% 120% at 0% 0%, var(--accent-soft), transparent 60%)`.
- Thumbnail/icon: `28×28px` container (list) or `36×36px` (card), `border-radius: var(--radius-inner)`, `var(--fill-2)` background, icon in `--text-secondary`. No background tinted by category.

### C. KPI tile
- Label (`12px`, secondary, `13px` tertiary icon) → value (`26px/600`, tabular) → context (`12px`, tertiary).
- Change: `▲ 12 %` in `--positive` / `▼` in `--negative` only if the comparison is meaningful; otherwise neutral context.
- Optional mini-sparkline on the right, `1.5px` stroke in `--chart-neutral`, last point in accent.

### D. Charts (common rules)
- **One colour for the data, the accent for the insight.** Bars and series in `--chart-neutral`; the accent marks the main series, the max value, the current period or the moving average.
- Heatmaps (calendar, typical week): single-hue accent ramp, `5` steps (`--chart-track`, then accent at `0.20 / 0.38 / 0.62 / 1`). Cells with `border-radius: 3-4px`.
- Rankings (top tools, top files): `4px` tall bar, `border-radius: 2px`, `--chart-track` track, `--chart-neutral` bar, #1 in `--text-secondary` (a lighter neutral). The accent on #1 is reserved for the **page's main ranking**: with several rankings, leaders all in accent make a gaudy page.
- Categorical (donut, stacked bars): `--cat-1…6`, sorted by value, the rest grouped as "Other" in `--cat-other`. Donut: thickness `14%` of the radius, `2px` gap between segments, total in the centre.
- Horizontal grid lines only, `1px --chart-grid`, axes at `11px` tertiary tabular. No plot-area border.
- Hover: level 4 tooltip; the other series drop to `opacity: 0.35`.

### E. Status module (sidebar bottom)
- **Optional**: only if the app has a live activity (sync, analysis, task, server). Otherwise, the sidebar bottom = profile/settings.
- `margin: 10px; padding: 10px 12px; border-radius: 12px; background: var(--surface-floating); backdrop-filter: blur(24px); box-shadow: 0 0 0 1px var(--border-subtle), var(--specular-top), 0 8px 24px rgba(0,0,0,0.3);`
- Content: `6px` status dot (accent if in progress, `--positive` if up to date, with a slow pulse only during an activity), two lines (`12px/600` + `11px` tertiary, short subtitle: a `240px` sidebar leaves ~20 characters), a `28×28px` `…` button that opens a menu (refresh, sources, settings; account name as a section header). Actions live in the menu and under their keyboard shortcut, not in aligned buttons that truncate the text.

### F. Controls & forms
- **Segmented control**: container `background: var(--fill-1); padding: 2px; border-radius: 8px; box-shadow: inset 0 0 0 1px var(--border-subtle);` segments `height: 24px; padding: 0 10px; font: 500 12px;`; the active segment is marked by the **Liquid Glass bubble** (section 5.I, radius `6px`), text `--text-primary`; inactive ones in `--text-secondary`. **No accent** on the segmented control.
- **Filter chips** (categories, statuses): `height: 26px; border-radius: 7px; background: var(--fill-1); border: 1px solid var(--border-subtle)`, `6px` dot in the categorical colour; the chosen chip loses its background and border and receives the Liquid Glass bubble.
- **Input field**: `height: 30px; background: var(--fill-1); border: 1px solid var(--border-subtle); border-radius: 8px; padding: 0 10px;` focus: `border-color: var(--accent-rim); box-shadow: 0 0 0 3px var(--accent-soft);`
- **Switch, checkbox, radio**: accent when active, `--fill-3` otherwise.
- **Tags / badges**: `height: 20px; padding: 0 7px; border-radius: 6px; background: var(--fill-2); font: 500 11px; color: var(--text-secondary);` + optional `6px` dot in the categorical colour. Never a solid coloured background.

### G. Lists & tables
- Rows `32px` (dense) or `44px` (with subtitle), `1px var(--border-subtle)` rules, no zebra striping.
- Column headers `11px/600` tertiary, sortable (`10px` chevron).
- Hovered row `var(--fill-1)`; selected row `var(--accent-soft)` + `inset 2px 0 0 var(--accent)`.
- Numeric columns right-aligned, `tabular-nums`.
- Inspector (detail on the right): `320-360px` panel, same material as the cards, separated by a rule.

### H. Popovers, menus, ⌘K palette
- Level 4. `border-radius: 14px` (palette) / `10px` (menu). Scrim behind a modal palette: `rgba(0,0,0,0.25)` with no blur.
- Palette: `50px` borderless field (`16px` text), results grouped under eyebrows (Recent sessions / Sessions, Pages, Actions), `38px` rows with a `24px` icon thumbnail in `--fill-2`, shortcut shown on the right in `--fill-2` keys. The active row carries the Liquid Glass bubble (without sliding: it follows the ↑↓ arrows and the hover). ↵ opens, esc or a click on the scrim closes. Palette footer: reminder of the keys.
- A search with no exact result always offers a fallback action ("All sessions containing "…"").

### I. Liquid Glass selection (the bubble)
The selection of a group (segments, sidebar, tab bar, chips, palette rows) is **a single glass bubble** that moves from one element to another, like the Apple Music bar. It is not used for table rows (selection in `--accent-soft`, section G).

**At rest**
- Material: `regular` glass (macOS 26+ `glassEffect`) over a `--fill-2` veil (dark) / `rgba(255,255,255,0.55)` (light), white specular rim `0.18` / `0.9`, shadow `0 1.5px 3px rgba(0,0,0,0.28)`.
- Radius: that of the element (`6px` segments, `7px` chips, `8px` rows).

**Selection change (click, keyboard)**
- The bubble slides to the new element on a bouncy spring: `var(--spring-bubble)` over `var(--duration-bubble)` (SwiftUI: `.spring(response: 0.42, dampingFraction: 0.66)`).
- Drop effect: at the start, `scale` `1 + var(--bubble-stretch)` along the direction of travel and `1 − 0.4 × stretch` across it for `120ms`, then back to `1` on a bouncy spring (`.bouncy(duration: 0.45, extraBounce: 0.2)`).
- The element's text becomes `--text-primary` with a `200ms` fade.

**Grab and drag**
- Pressing the **already selected** element: the bubble lifts immediately. Pressing **another** element: nothing moves until the pointer has travelled `4px`; a simple click stays a click (the element handles its own selection).
- Lifted: `+ var(--bubble-lift)` on each side, `clear` glass (more transparent), shadow `0 4px 8px`. It follows the pointer on an interactive spring (`response 0.22, damping 0.78`) and gradually takes the size of the two elements it lies between.
- Speed stretch: `stretch = min(0.2, |speed| / 3000 px/s)` along the path.
- **Lens**: under the held bubble, the content is blurred by the glass (`regular` material) and the titles reappear magnified `× var(--lens-scale)`, centred on the pointer, clipped to the bubble's shape, with the specular rim on top.
- `alignment` haptic feedback (trackpad) on each element crossed.
- Release: the bubble settles on the nearest element (bouncy spring + drop effect) and selects it.

**Accessibility**: with "Reduce motion", a simple `ease-out 150ms` slide, no drop, no stretch, no lens.

**On the web**: a `.bubble` element in `position: absolute` inside the container, moved only by `transform: translate() scale()` (never animated `left/width`) with `transition: transform var(--duration-bubble) var(--spring-bubble)`; the drop effect in `@keyframes` (`scale` stretched to `22%` then `1`). Drag: `pointerdown` / `pointermove` / `pointerup` with `setPointerCapture`, transition turned off while tracking. Glass: `backdrop-filter: blur(20px) saturate(180%)` + veil + rim. Lens: a clone of the row of elements inside the bubble, `transform: scale(var(--lens-scale))` with `transform-origin` at the pointer, `clip-path` to the bubble's shape.

---

## 6. MICRO-INTERACTIONS

1. **Hover on a clickable card**: `transition: background var(--duration-fast) ease, box-shadow var(--duration-normal) var(--spring-apple);` → `--surface-card-hover` background and a brighter `--rim`. **No translation or scaling** on data cards (it moves the numbers); `translateY(-1px)` tolerated on navigation tiles.
2. **Press**: buttons only, `:active { transform: scale(0.97); transition-duration: 80ms; }`.
3. **Appearance**: popovers `opacity 0 → 1` + `scale(0.98) → 1`, `var(--duration-fast) var(--spring-apple)`. View change: `120ms` fade, never a sideways slide.
4. **Reduced motion**: `@media (prefers-reduced-motion: reduce)` turns off transitions and pulses.
5. **Smoothness: never animate during a heavy render.** Showing a new page often costs `100-200ms` of layout on the main thread (SwiftUI, big DOM); an animation started in that same frame freezes mid-flight, which is the "lag" you see.
   - Page change: **the page shows first, the animation starts right after**, on a free main thread (SwiftUI: two `DispatchQueue.main.async` hops; web: two `requestAnimationFrame`). A start delayed by ~`100ms` is not visible, a mid-flight stop is.
   - Recomputed data that redraws the page (period change, filter change): apply it **once the bubble has settled** (`~400ms` after the action), not during its bounce.
   - Do not trigger the animation on mouse-down if a click is going to change the page: it would be cut off by the render.
   - Measurement: log the intervals longer than `30ms` between two ticks of a main-thread timer during view changes; none should fall during an animation.
6. **Scrollbars**: `::-webkit-scrollbar { width: 8px; } ::-webkit-scrollbar-thumb { background: var(--fill-3); border-radius: 9999px; border: 2px solid transparent; background-clip: content-box; } ::-webkit-scrollbar-track { background: transparent; }`

---

## 7. ACCESSIBILITY

- Text contrast ≥ 4.5:1 (tertiary is never used for essential information).
- The accent never carries information alone: the value, the shape or the label carries it too.
- Keyboard focus visible everywhere (accent ring from section F).
- Charts: every series has a label or a text legend; heatmap ramps have a "Less → More" legend.

---

## 8. NATIVE IMPLEMENTATION (SwiftUI / AppKit, macOS 26+)

On the Mac, this system is obtained first with the system components, then by tuning the colours:

| Concept | SwiftUI |
| --- | --- |
| Window + traffic lights | Standard `WindowGroup`, `.windowStyle(.hiddenTitleBar)` or `.windowToolbarStyle(.unified)`; never fake lights |
| Glass sidebar | `NavigationSplitView`: the sidebar column receives the system material (Liquid Glass on macOS 26+, `.sidebar` before); do not give it an opaque background |
| Inset stage | detail content with `.padding(8)` then `.background(Theme.stage, in: .rect(cornerRadius: 14, style: .continuous))` and an `.overlay` with a `1px` outline + top highlight |
| Toolbar | `.toolbar { }` with `ToolbarItem(placement: .principal)` for the search, `.searchable` if the standard behaviour is enough |
| Glass (level 4, status module) | macOS 26+: `.glassEffect(.regular, in: .rect(cornerRadius: 12))`, grouped in a `GlassEffectContainer`; fallback: `.background(.regularMaterial, in: …)` |
| Buttons | `.buttonStyle(.glassProminent)` (primary) / `.buttonStyle(.glass)` (secondary) on macOS 26+; `.borderedProminent` / `.bordered` before |
| Accent | `.tint(Theme.accent)` at the root; an adaptive light/dark `Color` |
| Numbers | `.monospacedDigit()` |
| Charts | Swift Charts: `.foregroundStyle(Theme.chartNeutral)` by default, `Theme.accent` for the highlighted series |
| Radii | `RoundedRectangle(cornerRadius:style: .continuous)` everywhere (squircle curve) |
| Liquid Glass bubble (5.I) | Each element publishes its frame in a named `coordinateSpace` through a `PreferenceKey`; the container draws **one** bubble in `.background` at that frame. Drag: `DragGesture(minimumDistance: 0)` as a `.simultaneousGesture` (buttons keep the click). Drop effect: `.keyframeAnimator(trigger:)` (`CubicKeyframe` then `SpringKeyframe` `.bouncy`). Glass: `.glassEffect(lifted ? .clear : .regular, in: shape)`. Lens: copy of the content in `.overlay`, `.scaleEffect(1.2, anchor: pointer)`, `.mask` to the bubble's shape, on a `.regularMaterial` background. Haptics: `NSHapticFeedbackManager.defaultPerformer.perform(.alignment, …)`. For freely placed rows without dragging (palette): `matchedGeometryEffect(isSource: false)` |
| Smoothness (6.5) | The bubble shows a "shown" selection updated after the render: `.onChange(of: selection) { DispatchQueue.main.async { DispatchQueue.main.async { withAnimation(spring) { shown = new } } } }`; recomputed data applied after `≥ 0.4 s` |
| Navigation history | Back / forward stack in the model, ‹ › toolbar arrows, `⌘[` / `⌘]` in a "Go" menu |

Always wrap recent APIs: `if #available(macOS 26, *) { … } else { … }`.

---

## 9. CHECKLIST BEFORE SHIPPING A VIEW

- [ ] **Graphite first**: on a screenshot, the accent is less than 5% of the surface and you see the numbers before the colour.
- [ ] **A single accent** in the whole app; no other hue outside semantics and categorical charts.
- [ ] **Arc frame**: stage detached by `8px` (top, right, bottom), `14px` radius concentric with the window radius.
- [ ] **Glass**: translucent sidebar, level 4 popovers; nearly opaque stage.
- [ ] **Neutral specular rim** on top of every surface; accent rim on one featured card at most.
- [ ] **macOS typography**: `13px` body, `28px` view titles, figures in `tabular-nums`.
- [ ] **Charts**: neutral for data, accent for the insight, muted categorical palette ≤ 6 + Other.
- [ ] **Light and dark** both checked.
- [ ] **Native**: no system component redrawn (lights, sidebar, menus) when the app is in SwiftUI.
- [ ] **Liquid Glass bubble**: a single bubble per selection group; it slides, bounces, can be grabbed and magnifies the titles like a lens; a click stays a click.
- [ ] **Smoothness**: no animation starts in the frame that builds a new page; no block longer than `30ms` during an animation.
- [ ] **Reduce motion** respected (no bounce, stretch or lens).
