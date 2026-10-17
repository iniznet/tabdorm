# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

WXT (MV3) + Svelte 5 runes + Tailwind v4 with design tokens in `src/app.css`. Side panel, popup, and options are separate entrypoints. All-extension UI is local; no server, no accounts.

## Users

One person managing their own tab herd in Chrome. They open the side panel mid-browsing for a few seconds — between two tasks, with 40–300 tabs open — and they open the options page rarely, to set policy once.

## Jobs

- Find the tabs I abandoned weeks ago and get rid of them without losing anything.
- Stop Chrome from eating RAM, without breaking the tab I am working in.
- Keep a recoverable record (snapshot) of anything I close in bulk.

## What it makes possible

TabDorm's different mechanism: it never replaces pages with placeholder tabs and never rewrites URLs (no fake "suspended.html"). Dormancy is native `tabs.discard` plus a live shadow tree of real tabs; reopening is free because the tab was never faked. Snapshots in IndexedDB make bulk closing reversible.

## Success

The user closes a batch of stale tabs in under ten seconds, trusts the undo path (snapshot exists), and never has to reason about why a working tab was taken away.

## Constraints

- MV3, no content scripts, no injection into pages.
- Side panel width is variable and narrow; the UI must hold at a 320 px floor with zero horizontal overflow.
- Every number, threshold, and rule comes from config; the UI never hardcodes policy.
- Draft protection and battery guard are opt-in permission features; their absence must degrade visibly, not silently.
- Keyboard reachable end to end; focus visible on every control.

## Terminology

"Tab" (a real Chrome tab), "asleep/suspended" (discarded, URL intact), "stale" (no visit in N days), "snapshot" (a saved set of tabs that can be restored), "collection" (a named, pinnable set the user curates), "whitelist" (never touch), "route" (an auto-grouping rule).

## Non-goals

Syncing across machines, accounts, telemetry, cross-browser support, and any feature that requires reading page content.
