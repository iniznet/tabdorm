# Suspension Engine

The suspension engine puts inactive tabs to sleep using Chromium’s native `chrome.tabs.discard()`. A discarded tab is unloaded by the browser itself: its renderer process is freed, but the tab keeps its real title, URL, favicon, and strip position. Clicking it reloads the original page. TabDorm never opens placeholder pages and never rewrites URLs.

## Activity tracking

- Every tab activation (`tabs.onActivated`) and completed load (`tabs.onUpdated`, `status === complete` or an audible-state change) stamps a per-tab activity timestamp into `chrome.storage.session`.
- `chrome.storage.session` is in-memory per browser run: it survives service-worker restarts but is wiped when the browser restarts. That is why the engine **seeds** all open tabs’ clocks once per browser run (`ensureColdStartSeeded`, guarded by a session flag) — without seeding, unknown tabs read `lastActivity = 0` and the first sweep after a relaunch would mass-discard everything.
- The **Sleep Avalanche Guard** listens to `idle.onStateChanged`. On an `active` transition (system wake), it starts a cooldown and resets every tab’s activity clock so clock jumps during sleep cannot instantly qualify tabs as idle.

## The decision matrix

`evaluateSuspension()` in `src/core/suspension.ts` is a pure function — the entire suspension policy in one testable place. Verdicts are evaluated in strict order:

| Order | Condition | Verdict |
| --- | --- | --- |
| 1 | Active tab of the focused window | `skip` (never suspend what the user is looking at) |
| 2 | Wake cooldown active | `skip` |
| 3 | Active tab of an unfocused window (if exemption on) | `skip` (user may bounce straight back) |
| 4 | Pinned tab (if exemption on) | `skip` |
| 5 | Audible tab (if exemption on) | `skip` |
| 6 | Group color/title protected | `shield` |
| 7 | URL matches the whitelist | `shield` |
| 8 | Idle past the threshold | `discard` |
| 9 | Otherwise | `unshield` (restore `autoDiscardable`) |

`shield` does not just skip suspension — it sets `autoDiscardable: false` on the tab so **Chrome’s own Memory Saver** is also forbidden from killing it. The `memorySaverPolicy` knob controls this globally (`cooperative` = only shielded tabs are protected; `exclusive` = shield everything).

## Sweep lifecycle

1. A `chrome.alarms` timer fires every `sweepIntervalMinutes` (default 1 min; the alarm is resynced automatically whenever the config changes).
2. The sweep evaluates every tab in every window through the matrix and executes verdicts: discard, shield, or unshield.
3. The toolbar badge is refreshed with the number of currently discarded tabs (queried with `tabs.query({ discarded: true })`).
4. After the sweep, the group engine may collapse idle groups (see [group-engine.md](group-engine.md)).

The same sweep is available on demand: the popup’s *Suspend inactive tabs* button, the `runSweep` message, and the keyboard shortcut all reuse it.

## Defensive details

- **Discard race guard:** new tabs are never discarded synchronously at creation. Candidates are held in a pending set and flushed only after `webNavigation.onCommitted` (top frame) proves a real document load — avoiding Chromium errors on half-born tabs.
- **Benign error swallowing:** Chromium races produce expected errors ("tab was already discarded", "tabs cannot be edited right now", …). The discard wrapper classifies them and keeps the sweep alive; unexpected failures are logged, never thrown.
- **Never discards the focused tab:** enforced both by the matrix (`skip: active_tab`) and again inside the discard wrapper.