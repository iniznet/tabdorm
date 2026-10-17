# Stale tabs

TabDorm answers one question the tab strip cannot: **which tabs have I not looked at in a while?** The suspension engine cannot answer it, because its activity clock is deliberately volatile.

## Two clocks, two purposes

| Clock | Storage | Purpose |
| --- | --- | --- |
| Activity timestamps | `chrome.storage.session` (`core/activity.ts`) | Suspend decisions and idle group collapse. Wiped on browser restart, re-seeded to "now". |
| Visit records | `chrome.storage.local` (`core/tab-stats.ts`) | Stale-tab age. Survives restarts. |

Age is **never** derived from the session clock: a restart would reset it, and the cold-start seed deliberately stamps every tab as freshly visited.

## Visit records

- Key `tabdorm:tabStats`, shape `{ [tabId]: { firstSeen, lastActive } }`.
- Written on `tabs.onCreated` (a background tab keeps `lastActive = 0`, i.e. an unknown age), on `tabs.onActivated`, and on a completed navigation of the active tab.
- Dropped on `tabs.onRemoved`, and pruned against live tab ids at every bootstrap — tab ids are reused across browser runs, so a stale record must never be attributed to a new tab.
- Stored payload passes an explicit validator (`parseTabStats`); malformed records are dropped instead of trusted.

## The Stale view

`src/lib/ui/StaleTabs.svelte` (side panel) lists **every tab in every window**:

- Rows with no visit record sort first — the tracker never saw you open them — then the oldest visit first.
- Each row shows age, group title, and asleep 💤 / pinned 📌 / audible 🔊 badges. Clicking a row focuses that tab (which marks it visited).
- `stale.staleAfterDays` (Options → Stale tabs, default 7, 0 disables flagging) marks rows past the threshold; the header counts them.

## Bulk close safety

`selectClosable()` (pure, `src/core/stale.ts`) returns only rows that are stale **and** not the active tab, not pinned, and not playing audio. Unknown-age rows are excluded, because their staleness cannot be proven.

Closing goes through the `closeDuplicates` message, i.e. `closeDuplicateTabs()` in `core/close-duplicates.ts`: the active tab and any tab holding unsaved form input are skipped there as well. "Snapshot + close" takes a session snapshot first and aborts if the snapshot fails.

## Pure/reaction split

Age math, stale flagging, ordering, and close selection live in `src/core/stale.ts` with no `chrome.*` and no runtime imports. The chrome adapter (`core/tab-stats.ts`) and the Svelte view contain no policy.
