# Storage & Config

TabDorm uses three storage tiers, each matched to the volatility of its data:

| Tier | Contents | Lifetime |
| --- | --- | --- |
| `chrome.storage.sync` | The single `TabDormConfig` object (all knobs, whitelist, routing rules) | Synced across the user’s profile |
| `chrome.storage.session` | Tab activity timestamps, wake-cooldown deadline, previous-active-tab map, cold-start seed flag | In-memory; survives SW restarts, wiped on browser restart |
| IndexedDB (Dexie) | Session history: auto snapshots, saved sessions, closed-window captures | Persistent (`navigator.storage.persist()` requested at startup) |

## Config resolution

- `resolveConfig()` deep-merges any stored (possibly corrupt or stale) config over `DEFAULT_TAB_DORM_CONFIG`, clamping every numeric knob to declared bounds and coercing booleans. Malformed input can never produce an invalid runtime config.
- Every interval, threshold, delay, and rule comes from config — zero hardcoded behavior. New knobs must be added to the defaults **and** the resolver bounds together.
- Writes go through one path (`saveConfig`) which throws a descriptive error on `chrome.storage.sync` failures (e.g. the 8 KB per-item quota); the Options page surfaces that error as an alert instead of silently dropping settings. The in-memory cache is only updated after a successful write.
- Live edits from any surface invalidate the worker’s config cache via `storage.onChanged` — no restart needed.

## Session storage (IndexedDB)

- Dexie with explicit schema versioning; never mutate an existing version — new indexes append a new `version()` block (expand/contract).
- Collections are paginated with **keyset cursors** (default page 20, hard cap 100) newest-first; snapshots are never bulk-loaded into memory.
- `navigator.storage.persist()` is requested so the browser treats history as durable; if denied, a warning is logged.
- The Options page shows a live `navigator.storage.estimate()` readout.

## Volatile session storage

Activity data deliberately lives in `chrome.storage.session`: it is cheap, per-browser-run, and its wipe-on-restart is exactly what the cold-start seed relies on (a one-time flag distinguishes a fresh browser run from a mere service-worker restart).