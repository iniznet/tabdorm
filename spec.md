```markdown
# TabDorm — Lean Architecture & System Specification
**Version:** 1.2.0-lean  
**Platform:** Chromium Manifest V3 (MV3)  
**UI Engine:** Svelte 5 + Virtualized Rendering  
**License:** Open Source (MIT)  

---

## 1. Inspirations & Prior Art

TabDorm is an independent, clean-room TypeScript implementation inspired by three pioneering tools:
* **The Marvellous Suspender (and The Great Suspender):** Pioneered browser memory decluttering and tab idle lifecycles.
* **Session Buddy:** Established the standard for multi-window session recovery, timeline snapshots, and tab collections.
* **Google Chrome Tab Groups:** Native Chromium workspace grouping engine.

*Note on Licensing:* TabDorm does not reuse code from these projects. It uses native `chrome.tabs.discard()`, `chrome.tabGroups`, and Dexie.js for a modern, native-first architecture.

---

## 2. Core Invariants & Philosophy

1. **Native Over Simulated:** No placeholder redirect pages (`suspended.html`). Memory purging is handled exclusively through native `chrome.tabs.discard()`.
2. **Zero Hardcoded Behavior:** All timers, delays, whitelists, and routing rules are user-configurable via a typed config schema.
3. **Paced Restoration:** Sequential tab creation with micro-delays to guarantee zero CPU/RAM spikes on 50+ tab restorations.
4. **Zero-Trust Footprint:** Minimal permissions (`tabs`, `tabGroups`, `storage`, `alarms`, `downloads`, `webNavigation`, `idle`, `sidePanel`). No `<all_urls>` permission. No remote scripts or analytics.
5. **Infinite Data Scalability:** UI relies on Svelte 5 (Zero-VDOM) combined with DOM Virtualization (`@tanstack/svelte-virtual`) and IndexedDB cursor pagination to handle thousands of tabs at 60 FPS.

---

## 3. Technology Stack

* **Framework:** WXT (Vite-powered MV3 framework)
* **Language:** TypeScript (Strict)
* **UI Engine:** **Svelte 5 (Runes)** + **Tailwind CSS**
* **Virtualization:** `@tanstack/svelte-virtual` (for zero-lag infinite session scrolling)
* **Surface:** Chrome Side Panel (`chrome.sidePanel`) + minimal Popup
* **Storage:** 
  * `chrome.storage.sync`: User preferences, whitelists, and auto-routing rules.
  * `chrome.storage.session`: In-memory volatile tracking of tab idle timestamps.
  * `Dexie.js` (IndexedDB with `navigator.storage.persist()`): Historical snapshots and saved sessions.

---

## 4. Data Models

```ts
// types/session.ts
export type GroupColor = chrome.tabGroups.ColorEnum;
export type WindowState = chrome.windows.WindowState;

export interface StoredTab {
  url: string;
  title: string;
  favIconUrl?: string;
  pinned: boolean;
  isDiscarded: boolean;
  groupKey?: string; // Synthetic UUID linking tab to StoredGroup
}

export interface StoredGroup {
  key: string;       // Synthetic UUID (immune to duplicate/empty group titles)
  title: string;
  color: GroupColor;
  collapsed: boolean;
}

export interface StoredWindow {
  state: WindowState;
  left?: number;
  top?: number;
  width?: number;
  height?: number;
  groups: StoredGroup[];
  tabs: StoredTab[];
}

export interface UnifiedSession {
  id: string;        // UUIDv4
  name: string;
  timestamp: number;
  type: 'auto_snapshot' | 'user_saved' | 'closed_window';
  contentHash: string; // Fast hash for skipping identical auto-snapshots
  windows: StoredWindow[];
}
```

```ts
// types/config.ts
export interface AutoRouteRule {
  id: string;
  enabled: boolean;
  pattern: string;      // Wildcard (e.g., "*.github.com/*") or Regex
  groupTitle: string;   // e.g., "Code"
  groupColor: GroupColor;
  autoCollapse?: boolean;
}

export interface TabDormConfig {
  schemaVersion: number;
  suspension: {
    enabled: boolean;
    idleThresholdMinutes: number;
    sweepIntervalMinutes: number;
    memorySaverPolicy: 'cooperative' | 'exclusive' | 'custom_shield';
    exemptions: {
      pinnedTabs: boolean;
      audibleTabs: boolean;
      activeInOtherWindows: boolean;
      urlPatterns: string[];
      protectedGroupColors: GroupColor[];
      protectedGroupTitles: string[];
    };
    visualCue: {
      enabled: boolean;
      prefix: string; // e.g. "💤 "
    };
  };
  groups: {
    suspendOnGroupCollapse: boolean;
    autoCollapseOnIdleMinutes: number;
    routing: {
      enabled: boolean;
      reRouteAlreadyGrouped: boolean;
      rules: AutoRouteRule[];
    };
  };
  restoration: {
    batchSize: number;
    delayBetweenTabsMs: number;
    restoreAsDiscarded: boolean;
    restoreGroupsCollapsed: boolean;
    clampToBounds: boolean;
  };
  snapshots: {
    enabled: boolean;
    intervalMinutes: number;
    maxSnapshotsRetained: number;
    retentionDays: number;
    autoBackupDownloadDays: number;
  };
}
```

---

## 5. Subsystems & Essential Safeguards

### 5.1. Suspension Engine
* **Execution:** Evaluates tabs against user rules. Discards via native `chrome.tabs.discard(tabId)`.
* **Memory Saver Defense:** Sets `chrome.tabs.update(tabId, { autoDiscardable: false })` on whitelisted items to forbid Chrome from killing them under memory pressure.
* **Defensive Catch:** Catches benign Chromium errors (crashed tabs, tabs already discarded) to prevent service worker crashes.
* **Sleep Wake Guard:** `chrome.idle.onStateChanged` cooldown (2 minutes) to prevent clock-jump mass discards after waking a laptop.

### 5.2. Tab Groups & Auto-Routing Engine
* **Domain Auto-Routing:** Hooks into `webNavigation.onCommitted` (`frameId === 0`). Matches URLs against `AutoRouteRule[]`. Pinned tabs are exempt. Clusters matching tabs into existing groups or creates a new group.
* **Contiguity Rule (Topological Sort):** Restores tabs in strict index order (`0..N`). Groups contiguous slices atomically to prevent tab-strip scrambling.
* **Pinned Tab Mutual Exclusion:** Enforces that pinned tabs never enter tab groups.
* **Synthetic UUIDs:** Uses UUIDs so duplicate or empty group names never collide.

### 5.3. Session Engine & Real-Time Shadow Tree
* **Shadow Tree:** In-memory map of open tabs/groups. Captures closed windows on `chrome.windows.onRemoved` (after Chrome has already destroyed the tab objects).
* **Hash Deduplication:** Computes structural hashes to skip redundant identical auto-snapshots.
* **Sanitation Barrier:** Strips query tokens (`token`, `auth`, `utm_*`), drops `incognito` windows, and filters non-standard windows (`win.type === 'normal'` only).
* **Pending URL Fallback:** Reads `tab.url || tab.pendingUrl` to prevent blank tab saves.

### 5.4. Restoration Pipeline (Zero-CPU Lockup)
* Opens window with active tab focused for instant visual feedback.
* Clamps coordinates against `screen.availWidth`/`availHeight` to prevent off-screen windows on smaller monitors.
* Streams background tabs sequentially with a configurable pacing delay (default: 50ms).
* Discards background tabs on `webNavigation.onCommitted` to stop heavy DOM parsing.

### 5.5. Marvellous Suspender Migration
* Scans open tabs for `*/suspended.html*`.
* Extracts title from `#ttl=` and target URL from `uri=` (capturing everything after `uri=` to keep query parameters intact).
* Navigates the tab to its real URL, preserves its `groupId`, and discards it natively upon commit.
```

---

### Copy-Paste AI Implementation Prompt

***

```text
You are an expert browser extension systems architect and senior TypeScript engineer specializing in Manifest V3 (MV3), WXT, Svelte 5, and Dexie.js.

We are building "TabDorm", an ultra-lightweight, high-performance, open-source Chromium extension that cleanly unifies:
1. Native Tab Suspension (using chrome.tabs.discard - NO placeholder pages or fake redirects).
2. Native Chrome Tab Groups with Domain Auto-Routing (tab-sorting rules that cluster tabs into groups automatically).
3. Session Management & Snapshots (fast, reliable Session Buddy replacement with crash/closed-window recovery).

Prior Art & Attribution:
TabDorm is an independent clean-room implementation inspired by Marvellous Suspender, Session Buddy, and Chrome Tab Groups, built from scratch using native Chromium APIs.

### Core Engineering Invariants:
- Toolchain: WXT (Vite-powered MV3 framework) with TypeScript in strict mode.
- UI Framework: Svelte 5 (using Runes: $state, $derived, $effect) + Tailwind CSS.
- High-Data UI Scalability: Must use virtualized scrolling (@tanstack/svelte-virtual) in the Side Panel to render thousands of saved tabs and sessions at 60 FPS without DOM lag.
- Primary Surface: Chrome Side Panel (chrome.sidePanel) and a minimal quick-action Popup.
- Storage Strategy:
  - chrome.storage.sync: User preferences, whitelist rules, and AutoRouteRule configuration.
  - chrome.storage.session: Volatile in-memory tab activity timestamps.
  - Dexie.js (IndexedDB): Persistent session history with navigator.storage.persist() and cursor-based pagination (never load all snapshots into memory at once).
- Zero Hardcoding: All intervals, delays, thresholds, and routing rules must be read from a typed TabDormConfig object with default fallbacks.
- Zero-Trust Security: Minimal permissions only: ["tabs", "tabGroups", "storage", "alarms", "downloads", "webNavigation", "idle", "sidePanel"]. No <all_urls> permission. Strict CSP (no remote scripts, no eval).
- Native-First: Discarding relies strictly on native chrome.tabs.discard(). Tabs stay in their native groups with authentic titles, URLs, and favicons.

### Critical Engineering Safeguards You Must Implement:
1. Domain Auto-Routing Engine:
   - Hook into webNavigation.onCommitted (top-level frameId === 0 only).
   - Match committed URLs against active AutoRouteRule[].
   - If a rule matches and the tab is not pinned (and not already manually grouped unless reRouteAlreadyGrouped is enabled), append it to an existing group matching groupTitle + groupColor in that window, or create the group if it doesn't exist.
2. Discard Race Guard: Never call chrome.tabs.discard() synchronously on newly created tabs. Wait for webNavigation.onCommitted before discarding to avoid Chromium errors.
3. Contiguity Rule: Chromium tab groups must be physically contiguous. When restoring a session, sort tabs topologically by index and group contiguous slices atomically via chrome.tabs.group({ tabIds }).
4. Closed Window Shadow Tree: chrome.windows.onRemoved fires after tabs are already destroyed. Maintain a live in-memory Shadow Tree of active tabs/groups so closed windows can be captured instantly.
5. AutoDiscardable Shielding: Protect whitelisted tabs/groups from Chrome's built-in Memory Saver by setting chrome.tabs.update(tabId, { autoDiscardable: false }).
6. Paced Restoration: Never restore tabs with Promise.all(). Sequentially stream background tabs with a configurable delay (default: 50ms) to ensure flat CPU and RAM usage.
7. Sleep Avalanche Guard: Listen to chrome.idle.onStateChanged. When waking from sleep, trigger a 2-minute cooldown resetting activity timestamps to prevent mass discard storms caused by clock jumps.
8. Geometry Clamping: Clamp saved window left/top coordinates against screen.availWidth/Height so windows never open off-screen when switching monitors.
9. URL Sanitation: Read tab.url || tab.pendingUrl. Filter out incognito windows and non-standard windows (win.type === 'normal' only). Strip sensitive parameters ('token', 'auth', 'utm_*').
10. TMS Migration: Provide a parser for Marvellous Suspender URLs (suspended.html#ttl=...&uri=...) that takes everything after uri= as the destination to avoid breaking on query parameters.

### Implementation Tasks for Step 1:
1. Set up the WXT project configuration (wxt.config.ts) and manifest permissions.
2. Create the strict TypeScript schemas in `src/types/`:
   - `StoredTab`, `StoredGroup`, `StoredWindow`, `UnifiedSession`
   - `AutoRouteRule` and `TabDormConfig` with all configurable options and safe default constants.
3. Implement the Dexie.js database client in `src/core/db/` with schema versioning, cursor pagination helpers, and navigator.storage.persist() call.
4. Implement the background service worker in `src/entrypoints/background.ts`:
   - The Shadow Tree manager (tracking live tabs, groups, and window states).
   - The Domain Auto-Routing listener on webNavigation.onCommitted.
   - Safe discard wrapper with error handling.
   - chrome.idle wake-cooldown listener.

Generate clean, idiomatic, fully-typed TypeScript code without placeholders.
```