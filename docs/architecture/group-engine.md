# Group Engine

TabDorm works on **native Chrome tab groups** (`chrome.tabGroups`) — real strip visuals, real collapse state, real colors. Two subsystems live here: domain auto-routing and the collapse engine.

## Domain auto-routing

- Hooks `webNavigation.onCommitted` with `frameId === 0` only (top-level navigations).
- The committed URL is matched against user-ordered `AutoRouteRule[]`. Patterns accept wildcard syntax (`*.github.com/*`) or raw regex (prefix the pattern with `regexp:`). Invalid patterns are skipped, never thrown.
- A matching, un-pinned tab joins an existing group with the rule’s **title + color** pair in that window, or a new group is created. Duplicate or empty titles can’t collide because groups are keyed by synthetic UUIDs.
- `reRouteAlreadyGrouped` controls whether already-grouped tabs are re-evaluated; pinned tabs never enter groups (Chromium mutual exclusion).
- A rule’s `autoCollapse` flag folds its group on route/creation.

## The collapse engine

Three collapse sources exist, and **all of them funnel through a single reaction point** on `tabGroups.onUpdated` (`src/core/group-collapse.ts`), so suspension-on-collapse behavior is defined exactly once:

1. **Collapse on switch** (`groups.collapseOnSwitch`): the worker tracks the previously active tab per window in `chrome.storage.session`. When you activate a tab in a different group — or in the ungrouped area — the group you *left* is collapsed. The group you enter is never touched, and the collapsed group never contains the active tab (which is why Chromium accepts the update).
2. **Idle collapse** (`groups.autoCollapseOnIdleMinutes`, 0 = off): after every suspension sweep, any uncollapsed group whose member tabs have all been idle past the threshold is collapsed. A group containing the active tab of a focused window is always exempt. Group idleness is derived from the same per-tab activity timestamps the suspension engine uses — no separate storage.
3. **Manual collapse by the user** — clicking a group header in the strip.

On every collapse *transition*, if `groups.suspendOnGroupCollapse` is enabled, the collapsed group’s inactive tabs are run through the **same forced-idle decision matrix** (idle math short-circuited, every other exemption intact): audible, whitelisted, and protected-group tabs keep their shields; the focused tab is skipped.

## Implementation notes

- `tabGroups.onUpdated` delivers no changeInfo in @types/chrome 0.3.x, so collapse transitions are detected with a seeded state map (`groupId → collapsed`) instead of change events.
- The collapse engine is separate from the suspension engine by design: group-collapse imports the pure matrix from `suspension.ts`; the background worker orchestrates sweep → idle-collapse → badge in one helper, avoiding circular imports.