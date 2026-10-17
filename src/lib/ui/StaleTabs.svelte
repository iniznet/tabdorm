<script lang="ts">
  import { ageLabel, isStale, selectClosable, sortStale, type StaleRow } from '@/core/stale';
  import { getTabStats } from '@/core/tab-stats';
  import { getConfig } from '@/core/config-store';
  import { sendToBackground } from '@/core/messaging';
  import { describeCloseOutcome, parseCloseOutcome } from '@/core/close-duplicates';

  const GROUP_NONE = -1;

  let rows: StaleRow[] = $state([]);
  let threshold: number = $state(0);
  let open: boolean = $state(false);
  let busy: boolean = $state(false);
  let filter: string = $state('');
  let notice: string = $state('');

  const now = Date.now();
  const sorted = $derived(sortStale(rows));
  const staleRows = $derived(rows.filter((row) => isStale(row, threshold, now)));
  const closable = $derived(selectClosable(rows, threshold, now));
  const visible = $derived(
    filter.trim() === ''
      ? sorted
      : sorted.filter((row) =>
          (row.title + ' ' + row.url + ' ' + (row.groupTitle ?? '')).toLowerCase().includes(filter.trim().toLowerCase()),
        ),
  );

  async function scan(): Promise<void> {
    const [tabs, groups, stats, config] = await Promise.all([
      chrome.tabs.query({}),
      chrome.tabGroups.query({}),
      getTabStats(),
      getConfig(),
    ]);
    const titles = new Map<number, string>();
    for (const group of groups) {
      const title = group.title;
      if (title !== undefined && title !== '') titles.set(group.id, title);
    }
    threshold = config.stale.staleAfterDays;
    rows = tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) => {
        const tabId = tab.id as number;
        const stat = stats[String(tabId)];
        const groupId = tab.groupId === undefined ? GROUP_NONE : tab.groupId;
        return {
          tabId,
          windowId: tab.windowId,
          title: tab.title === '' || tab.title === undefined ? (tab.url ?? '') : tab.title,
          url: tab.url ?? tab.pendingUrl ?? '',
          groupTitle: groupId === GROUP_NONE ? null : (titles.get(groupId) ?? null),
          pinned: tab.pinned === true,
          active: tab.active === true,
          audible: tab.audible === true,
          discarded: tab.discarded === true,
          firstSeen: stat?.firstSeen ?? 0,
          lastActive: stat?.lastActive ?? 0,
        };
      });
  }

  $effect(() => {
    void scan();
    // Tab events arrive per load-progress step; coalesce into one scan per burst.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const scheduleScan = (): void => {
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => void scan(), 300);
    };
    chrome.tabs.onCreated.addListener(scheduleScan);
    chrome.tabs.onRemoved.addListener(scheduleScan);
    chrome.tabs.onUpdated.addListener(scheduleScan);
    chrome.tabs.onActivated.addListener(scheduleScan);
    return () => {
      if (pending !== undefined) clearTimeout(pending);
      chrome.tabs.onCreated.removeListener(scheduleScan);
      chrome.tabs.onRemoved.removeListener(scheduleScan);
      chrome.tabs.onUpdated.removeListener(scheduleScan);
      chrome.tabs.onActivated.removeListener(scheduleScan);
    };
  });

  /** Closes through the background so active and unsaved-form tabs are protected. */
  async function closeTabs(tabIds: number[], withSnapshot: boolean): Promise<void> {
    if (tabIds.length === 0) return;
    busy = true;
    notice = '';
    try {
      if (withSnapshot) {
        const snapshot = await sendToBackground({ type: 'snapshotNow' });
        if (!snapshot.ok) {
          notice = 'Snapshot failed: ' + (snapshot.error ?? 'unknown error');
          return;
        }
      }
      const res = await sendToBackground({ type: 'closeDuplicates', tabIds });
      const outcome = res.ok ? parseCloseOutcome(res.payload) : null;
      if (outcome !== null) notice = describeCloseOutcome(outcome);
      else notice = res.ok ? 'Close failed: unexpected response.' : 'Close failed: ' + res.error;
    } finally {
      busy = false;
    }
    await scan();
  }

  async function closeStale(withSnapshot: boolean): Promise<void> {
    const targets = selectClosable(rows, threshold, Date.now()).map((row) => row.tabId);
    if (targets.length === 0) {
      notice = 'No stale tab to close.';
      return;
    }
    const label = withSnapshot ? 'Snapshot, then close' : 'Close';
    if (!window.confirm(label + ' ' + targets.length + ' stale tab(s)? Pinned, active, audible and unsaved-form tabs are kept.')) return;
    await closeTabs(targets, withSnapshot);
  }

  async function focusTab(row: StaleRow): Promise<void> {
    await chrome.tabs.update(row.tabId, { active: true }).catch(() => undefined);
    await chrome.windows.update(row.windowId, { focused: true }).catch(() => undefined);
    await scan();
  }
</script>

<div class="rounded-md border border-line bg-raised/60">
  <button
    class="flex w-full items-center gap-2 px-2 py-1.5 text-left"
    onclick={() => (open = !open)}
    aria-expanded={open}
    aria-controls="stale-tabs-list">
    <span class="min-w-0 flex-1 truncate text-xs font-semibold {staleRows.length > 0 ? 'text-warn' : 'text-dim'}">
      {staleRows.length} stale of {rows.length} tab{rows.length === 1 ? '' : 's'}
      {#if threshold > 0}<span class="font-normal text-faint">· {threshold}d+</span>{/if}
    </span>
    <span class="text-[10px] text-faint">{open ? '▾' : '▸'}</span>
  </button>

  {#if open}
    <div class="border-t border-line/60 px-2 py-1.5">
      <div class="flex flex-wrap items-center gap-1.5">
        <button
          class="rounded-md border border-line px-2 py-1 text-[10px] font-medium text-dim hover:border-faint hover:text-ink disabled:opacity-40"
          disabled={busy || closable.length === 0}
          onclick={() => void closeStale(true)}>Snapshot + close {closable.length}</button
        >
        <button
          class="rounded-md border border-bad/40 px-2 py-1 text-[10px] font-medium text-bad hover:bg-bad/10 disabled:opacity-40"
          disabled={busy || closable.length === 0}
          onclick={() => void closeStale(false)}>Close {closable.length}</button
        >
        <input
          class="min-w-0 flex-1 rounded-md border border-line bg-overlay px-2 py-1 text-[10px] text-ink placeholder:text-faint"
          placeholder="Filter…"
          bind:value={filter}
        />
      </div>

      {#if notice !== ''}
        <p class="mt-1.5 rounded-md bg-overlay px-2 py-1 text-[10px] text-dim" role="status">{notice}</p>
      {/if}

      <ul class="mt-1.5 flex max-h-56 flex-col gap-0.5 overflow-y-auto" id="stale-tabs-list">
        {#each visible as row (row.tabId)}
          <li
            class="group flex h-6 items-center gap-1.5 rounded px-1 text-[11px] {isStale(row, threshold, now)
              ? 'bg-warn/10'
              : ''} hover:bg-overlay"
          >
            <span class="w-16 shrink-0 tabular-nums {isStale(row, threshold, now) ? 'text-warn' : 'text-faint'}"
              >{ageLabel(row.lastActive, now)}</span
            >
            <button
              class="min-w-0 flex-1 truncate text-left {row.active ? 'font-semibold text-ink' : 'text-dim'} hover:text-ink"
              title={row.url}
              onclick={() => void focusTab(row)}>{row.title}</button
            >
            {#if row.groupTitle !== null}
              <span class="shrink-0 max-w-20 truncate rounded bg-overlay px-1 text-[9px] text-faint" title="Tab group"
                >{row.groupTitle}</span
              >
            {/if}
            {#if row.discarded}<span class="shrink-0 text-[9px]" title="Asleep">💤</span>{/if}
            {#if row.pinned}<span class="shrink-0 text-[9px]" title="Pinned">📌</span>{/if}
            {#if row.audible}<span class="shrink-0 text-[9px]" title="Playing audio">🔊</span>{/if}
            <button
              class="shrink-0 rounded px-1 text-[10px] text-faint opacity-0 group-hover:opacity-100 hover:bg-line hover:text-bad"
              title="Close tab"
              onclick={() => void closeTabs([row.tabId], false)}>✕</button
            >
          </li>
        {/each}
      </ul>
      {#if visible.length === 0}
        <p class="p-2 text-center text-[10px] text-faint">
          {rows.length === 0 ? 'No open tabs.' : 'No tab matches that filter.'}
        </p>
      {/if}
    </div>
  {/if}
</div>
