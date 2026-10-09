# AGENTS.md — TabDorm

## Project Invariants & Reusable Conventions

- **Toolchain:** WXT 0.21 + TypeScript (strict, noUncheckedIndexedAccess), Svelte 5 runes, Tailwind v4, Dexie v4.
- **tsconfig:** `"types": ["chrome"]` is REQUIRED — @types/chrome 0.3.x is not auto-included by the extended WXT tsconfig.
- **@types/chrome 0.3.x API shapes:** `chrome.tabGroups.TAB_GROUP_ID_NONE` (not `TabGroup.NONE_ID`); `tabGroups.onUpdated` receives only `(group)`; change-info type is `chrome.tabs.OnUpdatedInfo`; `windows.create()` resolves `Window | undefined`; `tabs.group()` requires `tabIds: [number, ...number[]]` (non-empty tuple). `GroupColor`/`WindowState` are template-literal unions over the enums.
- **Git:** `core.autocrlf=false` local config (LF checkout). Stage by explicit path only — never `git add .`.
- **Dexie:** `Table<StoredSession, number, UnifiedSession>` — the third generic is the InsertType so `add()` accepts sessions without the auto-increment `rev`. Never mutate an existing schema version; append a new `version()` block (Expand/Contract).
- **MV3 cold-start:** every `chrome.*` event listener must be registered synchronously inside `defineBackground()` — never after an await.
- **Svelte 5:** no `context="module"` scripts (deprecated) — put helpers in the instance script. For @tanstack/svelte-virtual, pass `get count()` (getter, not a captured value) and sync changes via `get(virtualizer).setOptions({ count })` in a `$effect`.
- **Tailwind:** never build class names by string interpolation — dynamic values need static lookup maps (Tailwind can't see dynamic classes).
- **Zero hardcoding:** all timers/thresholds/rules come from `TabDormConfig` via `getConfig()`; add new knobs to `DEFAULT_TAB_DORM_CONFIG` + `resolveConfig` bounds together.
- **Cold-start seeding:** activity timestamps live in `chrome.storage.session` (wiped on browser restart) — `ensureColdStartSeeded()` must run from background bootstrap; seeding on every SW wake would reset idle clocks and silently disable suspension.
- **Badge/menus/commands:** the asleep-count badge rides on sweep completion + tab removal; context menus are recreated idempotently (`removeAll` → `create`) because SW restarts wipe menu registrations.
- **Group collapse:** every collapse source funnels through the single `tabGroups.onUpdated` reaction point in `core/group-collapse.ts` (`suspendOnGroupCollapse`); never add per-source discard logic. Collapse-transition detection is stateful (`collapsedState` map) because `tabGroups.onUpdated` delivers no changeInfo in @types/chrome 0.3.x.
- **Design tokens:** all surfaces use the `@theme` palette in `src/app.css` (`surface/raised/overlay/line/ink/dim/faint/accent/good/warn/bad`) — never a raw hex or `neutral-800`-style default in a component.
- **Options page:** every config knob must be editable in `src/entrypoints/options/`; UI writes go through `resolveConfig()` (single write path, DangerZone's `update` pattern) — never raw `chrome.storage` sets.
- **Battery state:** the service worker may lack `navigator.getBattery`; `core/battery.ts` feature-detects it and otherwise falls back to `reportBattery` messages from UI surfaces (10-min staleness ceiling) — never assume the SW can read battery directly.
- **Verification:** `npx tsc --noEmit` + `npx svelte-check` + `npx wxt build` before every commit.
- **Duplicates:** URL comparison ALWAYS goes through `normalizeUrl()` in `core/duplicates.ts` (strips hash + www + tracking params, sorts query) — never raw `tab.url` equality. The core module is chrome-free; the chrome-touching closer lives in `core/close-duplicates.ts` and must keep skipping active + dirty-form tabs.
