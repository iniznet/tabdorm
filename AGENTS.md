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
- **Verification:** `npx tsc --noEmit` + `npx svelte-check` + `npx wxt build` + `npx tsx tasks/step*-smoke-probes.ts` before every commit.
