# Sessions & Restoration

## The shadow tree

`chrome.windows.onRemoved` fires *after* Chrome has already destroyed the window’s tab objects — too late to capture anything. TabDorm therefore maintains a live in-memory **shadow tree** of open windows, tabs, and groups (updated from `tabs.*` / `tabGroups.*` events). When a window closes, its state is snapshotted from the shadow tree and persisted as a `closed_window` session.

After a service-worker restart the shadow tree hydrates lazily from the live Chrome APIs on first access — no warm-up burst required.

## Snapshot lifecycle

- **Auto snapshots** fire on an alarm (default every 15 min, configurable). Before writing, the shadow tree state is hashed structurally; if the hash equals the latest auto-snapshot, nothing is written (a no-op browser state must not pile up history).
- **Retention** enforces both a count cap (`maxSnapshotsRetained`) and an age cap (`retentionDays`), pruned with cursor/batch queries — never a bulk load.
- **Auto backup** can periodically download the newest snapshot as JSON to disk (`autoBackupDownloadDays`).
- **Manual snapshots** (`Snapshot now`) and **JSON export/import** are always available; imported files are strictly validated (window/tab shape, required URL + title) and always re-stamped with a fresh UUID and `user_saved` type.

### Sanitation barrier

Before anything is stored: sensitive query parameters (`token`, `auth`, `utm_*`) are stripped; incognito windows are dropped; only `type === normal` windows are captured; and `tab.url || tab.pendingUrl` is read so freshly navigating tabs never save as blank.

## Paced restoration

Restoring a 50+ tab session never blocks the CPU:

- Tabs are created **sequentially in batches** (`restoration.batchSize`) with a configurable micro-delay between tabs (`restoration.delayBetweenTabsMs`, default 50 ms) — never `Promise.all()`.
- `restoration.restoreAsDiscarded` creates background tabs in the discarded state so they cost no memory until activated.
- **Contiguity rule:** Chromium groups must be physically contiguous. Restored tabs are ordered by index and group slices are grouped atomically (`chrome.tabs.group({ tabIds })`) so the strip never scrambles.
- Window geometry is clamped against the current screen’s `availWidth/availHeight` before window creation, so sessions restored onto a smaller monitor never open off-screen.
- **Selective restore:** the detail view lets you cherry-pick individual tabs (addressed by snapshot position, `{windowIndex, tabIndex}`) and choose a destination — original windows (default), one merged new window (groups rebuilt from the merged slices), or appended to the caller’s current window (groups deliberately left untouched so the live strip is never disturbed). Pinned state is preserved in every destination.
- **Paste-links import:** arbitrary text is scanned for unique http(s) URLs (capped at 500) in `core/url-extract.ts`; the extracted list can be opened as paced tabs or saved directly as a session.
- **Collections** (`core/db/collections.ts`, Dexie v2 table) are user-curated, named, color-coded, pinnable tab lists with duplicate-URL detection — a lighter organizational layer on top of snapshots.

## Native restore guard

Chrome rebuilds a tab strip from persisted state on two occasions and loads every tab each time —
extension-driven discard state survives neither trip. `core/restore-guard.ts` matches the live
strip positionally (normalized URLs, count within tolerance) against stored snapshots and
re-discards the background tabs that were asleep through `discardTabSafe`; a tab still mid-load
falls through to the Discard Race Guard and is discarded once its document commits.

- **Browser start** — `chrome.runtime.onStartup`, once per browser run (a `chrome.storage.session`
  marker, wiped on restart), up to three passes 2 s apart so a strip still streaming in gets
  matched once its tabs arrive. The restored windows exist before this worker registers its
  listeners, so `windows.onCreated` never fires for them.
- **Ctrl+Shift+T** — `chrome.windows.onCreated`: one window matched against snapshots newer than
  `nativeRestoreGuardWindowMinutes`.

Candidates are the newest `closed_window` **and** `auto_snapshot` rows. A killed browser writes no
`closed_window` row at all (`windows.onRemoved` never fires), which makes the periodic auto
snapshot the record of its last strip. No age cutoff applies at browser start, because the
browser may have been closed overnight: the positional URL match at `nativeRestoreGuardMatchPct`
is the gate. TabDorm's own paced restoration marks its windows self-restored, so the guard never
fights `restoration.restoreAsDiscarded`. The matching rules are pure and Node-tested in
`core/restore-match.ts`; the knobs live under `restoration.nativeRestoreGuard*`.

**Limit:** Chrome begins loading restored tabs before any extension can run, so the first fetch of
each tab cannot be suppressed. The guard releases the renderer at the first document commit — the
unloaded state comes back, not a skipped request.

## TMS migration

The Marvellous Suspender encodes real destinations in `suspended.html#ttl=…&uri=…` fragment URLs. The migration engine (`migrateAll`) scans open tabs for that shape, decodes everything after `uri=` (query strings included), and rewrites the tabs back to their original URLs — a one-click escape hatch from the dead extension.