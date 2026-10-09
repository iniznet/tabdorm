# TabDorm

> Native tab suspension, tab-group auto-routing, and fast session snapshots for Chromium — with zero placeholder pages.

TabDorm is an open-source Chromium (Manifest V3) extension that frees memory by putting inactive tabs to sleep with the browser’s **native** `chrome.tabs.discard()` mechanism — sleeping tabs keep their real title, URL, favicon, and position in the tab strip. It also auto-sorts tabs into native Chrome tab groups, keeps fast session snapshots with closed-window recovery, and can migrate sessions from The Marvellous Suspender.

## Features

- **Native suspension** — no fake `suspended.html` redirect pages. Asleep tabs are real Chromium discarded tabs; clicking one reloads the original page instantly.
- **Automatic idle sweeping** — configurable idle threshold and sweep interval, with exemptions for pinned, audible, active-in-other-window tabs, URL whitelists, and protected group colors/titles.
- **Manual controls everywhere** — popup button, per-tab actions in the side panel, tab right-click menu (*Suspend this tab / Suspend other tabs / Never suspend this site*), and a keyboard shortcut (`Ctrl+Shift+S`).
- **Sleep Avalanche Guard** — after system wake, a cooldown plus an activity-clock reset prevents clock-jump mass discards.
- **Domain auto-routing** — wildcard/regex rules cluster tabs into native tab groups as you browse, with per-rule auto-collapse.
- **Group auto-collapse** — collapse the previous group when you switch away, collapse idle groups on a timer, and optionally suspend a group’s tabs the moment it collapses (works for manual collapses too).
- **Session snapshots** — periodic auto-snapshots with hash deduplication and retention caps, manual snapshots, closed-window capture, JSON export/import, and paced multi-window restoration that never spikes CPU.
- **TMS migration** — one-click import of The Marvellous Suspender tabs, decoding `suspended.html#uri=…` links back to their real URLs.
- **Memory-saver defense** — whitelisted and protected tabs are shielded from Chrome’s own Memory Saver via `autoDiscardable: false`.
- **Draft protection (opt-in)** — tabs with unsaved form input are never suspended; requires an explicit permission grant.
- **Battery guard (opt-in)** — suspension pauses while the machine runs on battery.
- **Collections** — save the current window’s tabs as named, color-coded, pinnable sets with duplicate detection.
- **Paste-links import** — paste any text (email, markdown, CSV); TabDorm extracts the URLs and opens them as tabs or saves them as a session.
- **Selective restoration** — cherry-pick individual tabs from a snapshot and restore to the original windows, one new window, or the current window.
- **Unified search** — one box searching open tabs, saved sessions, and collections (`in:open`, `in:sessions`, `in:collections` scope prefixes).
- **Customizable shortcuts** — five commands (suspend current/others, wake current, snapshot, toggle whitelist) rebindable at `chrome://extensions/shortcuts`.

## How it works

TabDorm is native-first end to end: it never injects content scripts, never opens placeholder pages, and never rewrites URLs. The background service worker keeps a live in-memory *shadow tree* of open tabs/groups, timestamps activity in `chrome.storage.session`, and evaluates every tab against a pure, user-configurable decision matrix. Snapshots live in IndexedDB (Dexie) behind cursor pagination so thousands of sessions stay fast.

Deep dives per subsystem live in [`docs/`](docs/INDEX.md):

- [`docs/architecture/suspension-engine.md`](docs/architecture/suspension-engine.md) — decision matrix, wake guard, cold-start seeding, Memory Saver shielding
- [`docs/architecture/group-engine.md`](docs/architecture/group-engine.md) — auto-routing, collapse-on-switch, idle collapse, suspend-on-collapse
- [`docs/architecture/sessions-and-restoration.md`](docs/architecture/sessions-and-restoration.md) — shadow tree, snapshots, paced restoration, TMS migration
- [`docs/architecture/storage-and-config.md`](docs/architecture/storage-and-config.md) — the three storage tiers, config resolution, quota handling

## Install

**From the Chrome Web Store:** coming soon.

**From source:**

```bash
npm install
npm run build        # outputs to .output/chrome-mv3
```

Then in Chrome: `chrome://extensions` → enable *Developer mode* → *Load unpacked* → select `.output/chrome-mv3`.

## Permissions

| Permission | Why it is needed |
| --- | --- |
| `tabs` | Read tab URLs/titles/pinned/audible state; discard (suspend) tabs; restore sessions |
| `tabGroups` | Auto-routing into native groups; group collapse control |
| `storage` | Config in `storage.sync`, volatile activity tracking in `storage.session` |
| `alarms` | Periodic suspension sweep and snapshot scheduler |
| `downloads` | Optional periodic snapshot backup to disk |
| `webNavigation` | Top-frame navigation events for routing and the discard race guard |
| `idle` | Sleep Avalanche Guard (wake detection) |
| `sidePanel` | The main management UI |
| `scripting` + `<all_urls>` *(optional)* | Only requested if you enable draft protection — registers a tiny watcher that reports unsaved form input |
| `contextMenus` | Tab right-click actions |

No host permissions by default, no remote code, no analytics, no telemetry. The only content script (draft protection) is strictly opt-in and installed only after you grant the permission in Options.

## Privacy

Everything stays on your machine. Session history lives in the extension’s own IndexedDB; settings sync only through your own Chrome profile’s `chrome.storage.sync`. Nothing is ever transmitted anywhere.

## Development

```bash
npm run dev          # watch mode + auto-load into Chromium
npm run compile      # tsc --noEmit
npm run zip          # store-ready zip in .output/
npx svelte-check     # Svelte diagnostics
```

Behavioral probe suites for each milestone live in `tasks/step*-smoke-probes.ts` (run with `npx tsx`).

## License

[MIT](LICENSE)