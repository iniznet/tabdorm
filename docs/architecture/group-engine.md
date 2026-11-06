# Group Engine

TabDorm works on **native Chrome tab groups** (`chrome.tabGroups`) — real strip visuals, real collapse state, real colors. Three subsystems live here: domain auto-routing, the collapse engine, and group ordering.

## Domain auto-routing

- Hooks `webNavigation.onCommitted` with `frameId === 0` only (top-level navigations).
- The committed URL is matched against user-ordered `AutoRouteRule[]`. Patterns accept wildcard syntax (`*.github.com/*`) or raw regex (prefix the pattern with `regexp:`). Invalid patterns are skipped, never thrown.
- A matching, un-pinned tab joins an existing group with the rule’s **title + color** pair in that window, or a new group is created. Duplicate or empty titles can’t collide because groups are keyed by synthetic UUIDs.
- `reRouteAlreadyGrouped` controls whether already-grouped tabs are re-evaluated; pinned tabs never enter groups (Chromium mutual exclusion).
- A rule’s `autoCollapse` flag folds its group on route/creation.

## The collapse engine

Three collapse sources exist, and **all of them funnel through a single reaction point** on `tabGroups.onUpdated` (`src/core/group-collapse.ts`), so suspension-on-collapse behavior is defined exactly once:

1. **Collapse on switch** (`groups.collapseOnSwitch`): the worker tracks the previously active tab per window in `chrome.storage.session`. When you activate a tab in a different group — or in the ungrouped area — the group you *left* is collapsed. The write is serialized: activations arrive in bursts and `chrome.storage.session` has no transactional update, so parallel handlers used to overwrite each other's previous tab and the collapse went quiet.
2. **Idle collapse** (`groups.autoCollapseOnIdleMinutes`, 0 = off): after every suspension sweep, any uncollapsed group whose member tabs have all been idle past the threshold is collapsed. Group idleness is derived from the same per-tab activity timestamps the suspension engine uses — no separate storage. A member with an unknown clock (`0`) blocks the group: a tab restored as discarded never fires `status === 'complete'`, so reading an unknown age as infinitely old folded every such group in one sweep.
3. **Manual collapse by the user** — clicking a group header in the strip.

**Invariant.** Every source funnels through `collapseGroupIfSafe()`, which re-reads the group at write time and refuses three cases: a group that is gone, a group already collapsed, and a group holding the active tab of its window. The last refusal is the point of the funnel. Folding the group you are looking at makes Chromium activate a neighbour, which fires another activation and folds the next group, so a single stale decision cascades until the whole strip is collapsed.

On every collapse *transition*, if `groups.suspendOnGroupCollapse` is enabled, the collapsed group’s inactive tabs are run through the **same forced-idle decision matrix** (idle math short-circuited, every other exemption intact): audible, whitelisted, and protected-group tabs keep their shields; the focused tab is skipped.

## Group ordering on activate

A long strip buries the group you are working in. The activated group can move to one end of the strip.

- `groups.orderOnActivate` selects `off`, `top`, or `bottom`. Default is `bottom`.
- `applyActiveGroupOrder()` (`src/core/move-groups.ts`) runs on every activation and is the only writer of `chrome.tabGroups.move`.
- `chrome.tabGroups` exposes no index on a TabGroup, so strip order is derived from tab order: a group sits where its leftmost member sits. Ungrouped tabs are ignored.
- A move happens only when the group is not already at the requested end, so a second activation inside the same group writes nothing. `-1` means "end of window" to Chrome, `0` means first.
- Ordering is independent of `collapseOnSwitch`: it works with collapse off.

## Focus restore on close

Chromium activates the *neighbouring* tab when you close the active one, and that neighbour is usually another member of the same group — so a "close and move on" gesture lands you sideways.

- The worker keeps a per-window **activation history** (most recent first) in `chrome.storage.session`, recording the group each tab was in when it was activated; `tabs.onUpdated` re-stamps the group when a tab is routed afterwards.
- On `tabs.onRemoved` for the active tab of a window, `pickRestoreTarget()` (`src/core/close-focus.ts`, pure) chooses the replacement from that history. Window closes (`isWindowClosing`) and untracked tabs never trigger a restore.
- `focus.onActiveTabClosed` selects the rule: `browser` (do nothing), `previous-tab` (the tab you came from), or `previous-other-group` (the most recent tab whose group differs from the closed tab's — the default; it stays out of the closed tab's group, and does nothing when every remembered tab shares that group).
- `focus.historyDepth` caps how far back the restore may walk. `focus.restoreSettleMs` is a grace window: if Chromium activates its own pick *after* ours, the restore is re-applied once inside that window. `0` disables the correction.

## Implementation notes

- `tabGroups.onUpdated` delivers no changeInfo in @types/chrome 0.3.x, so collapse transitions are detected with a seeded state map (`groupId → collapsed`) instead of change events.
- The collapse engine is separate from the suspension engine by design: group-collapse imports the pure matrix from `suspension.ts`; the background worker orchestrates sweep → idle-collapse → badge in one helper, avoiding circular imports.