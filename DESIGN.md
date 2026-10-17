# Design

<!-- impeccable:design-schema 1 -->

## World

**Night desk.** The side panel is browser furniture docked beside someone's actual work, so it is dark — but not the blue-slate/indigo dark of the generated-app default. The base is warm graphite, like a room lit by one lamp: neutral-dark surfaces with a faint warmth, warm off-white ink, hairlines instead of boxes. Meaning is carried by temperature, not decoration: **awake** tabs and primary actions are lamp amber, **asleep** tabs are cool moonlight teal, **stale** age is rust. A panel made of this reads as a place where tabs are resting, not as a dashboard.

Mode: **Operate** for side panel, popup, and options. Restraint shows as density, alignment, and state clarity. No persuasion devices: no kickers above headings, no hero metrics, no gradient text, no glass.

## Tokens

All colour lives in `src/app.css` under `@theme`. Components never name a hex.

| Token | Value | Role |
|---|---|---|
| `--color-surface` | `#0e0f11` | page / panel base |
| `--color-raised` | `#15171a` | sticky bars, hover surfaces |
| `--color-overlay` | `#1c1f23` | popovers, selected rows, inputs |
| `--color-line` | `#262a2f` | hairlines: row separators, panel edges |
| `--color-line-strong` | `#343941` | input borders, scrollbar thumb |
| `--color-ink` | `#f4f1ea` | primary text |
| `--color-dim` | `#a9a49b` | secondary text (≥ 4.5:1 on surface) |
| `--color-faint` | `#8a857c` | tertiary meta, disabled text |
| `--color-awake` | `#e9b46a` | active tab, primary action, focus ring |
| `--color-asleep` | `#6f9fae` | discarded / suspended state |
| `--color-stale` | `#c8836b` | stale age, ageing emphasis |
| `--color-good` | `#86b07a` | success, protection on |
| `--color-bad` | `#d0766b` | destructive text and borders |

Contrast: `ink`/`surface` ≈ 15:1, `dim`/`surface` ≈ 6.6:1, `faint`/`surface` ≈ 4.6:1. `awake`, `asleep`, `stale`, `bad` on `surface` all clear 4.5:1 for text and 3:1 as icon strokes. On coloured fills, text is `surface` (amber button = dark text), never white.

## Type

Operate surfaces stay on the platform UI stack —`ui-sans-serif, system-ui` — because they sit inside browser chrome and must match it. Character comes from scale, weight, and numerals, not from a downloaded display face:

- Scale: 11 / 12 / 13 / 15 / 18 / 22. Body and list text 13, meta 12, section headings 15 semibold, page titles 22.
- Numerals in ages, counts, and timings use `font-variant-numeric: tabular-nums` so columns align.
- Tracking: `-0.01em` on headings only. Never below `-0.02em`.
- Headings carry their own weight. No eyebrow or kicker label above a heading, anywhere.

## Layout

- **Side panel**: one column, 12 px gutter. A sticky command bar (search field + view switch) holds position; below it a single hairline-separated list. No card per row — a row is a row.
- **Row anatomy**: 20 px state column (icon, temperature-coloured) · title (one line, truncate, 500) · meta line (dim, 12 px, tabular: age · group · host) · action cluster pinned right, revealed on hover and always present on touch/focus.
- **View switch**: inline text tabs, active label in ink with a 1 px underline in `awake`; inactive in `dim`. Not a segmented pill bar.
- **Bulk bar**: appears only with a selection, rises from the bottom edge as a `raised` surface with a top hairline. Left: "N selected" and Clear. Right: primary `awake`-filled button (Snapshot + close), secondary outlined `bad` (Close). Destructive and safe differ by fill, position, and copy — never by colour alone.
- **Popup**: 360 px, the same row anatomy, capped to a short list plus a footer link into the side panel. Same dialect, less furniture.
- **Options**: sticky left rail (180–200 px) with the active section marked by a 2 px `awake` bar and ink label; content column max 640 px, sections separated by hairlines rather than cards. Controls keep native affordances.

## Depth and shape

Elevation is declared once per element: hairlines for structure, one soft shadow for the two floating layers only (`0 8px 24px rgb(0 0 0 / 0.45)` — sticky bulk bar, popup root). Radii: 10 px controls, 14 px panels; pills only for count badges. One 1 px border under a wide shadow never appears.

## Iconography

`src/lib/ui/Icon.svelte`: authored inline SVG, 16 px grid, 1.5 stroke, round caps and joins, `currentColor`. Emoji are banned as icons. Available names: `moon`, `sun`, `pin`, `speaker`, `clock`, `camera`, `close`, `search`, `chevron`, `trash`, `plus`, `check`, `alert`, `external`, `download`, `upload`, `refresh`, `layers`, `flask` (test action), `shield`, `zzz` (sleep indicator).

## Browser surfaces

Themed from the palette because they ship with the product: `::selection` (awake at 24% alpha), `caret-color` awake, scrollbar thumb `line-strong` on transparent track, `outline: 2px solid awake` at 1 px offset on `:focus-visible`, `text-underline-offset: 2px` for the few text links.

## Motion

One authored moment: the bulk bar rises 12 px with a 180 ms `cubic-bezier(0.16, 1, 0.3, 1)` ease-out. Row hover transitions background over 120 ms. Everything else is instant — a tool read for seconds should never animate its content. `prefers-reduced-motion` removes the rise and the transitions.

## States

Every list surface ships: default, hover, focus-visible, selected, disabled, empty (with the product's own sentence and one action), loading (a static "Reading tabs…" line, not a spinner carousel), and error (the real message plus retry).
