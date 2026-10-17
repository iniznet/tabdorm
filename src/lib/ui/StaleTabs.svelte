<script lang="ts">
  import { ageLabel, durationLabel, isStale, selectClosable, sortStale, type StaleRow } from '@/core/stale';
  import { getTabStats } from '@/core/tab-stats';
  import { getConfig } from '@/core/config-store';
  import { sendToBackground } from '@/core/messaging';
  import { describeCloseOutcome, parseCloseOutcome } from '@/core/close-duplicates';
  import Icon from '@/lib/ui/Icon.svelte';

  const GROUP_NONE = -1;

  let rows: StaleRow[] = $state([]);
  /** Staleness threshold in milliseconds; 0 disables flagging. */
  let thresholdMs: number = $state(0);
  /** Refreshed on every scan so "12 min" does not freeze at mount time. */
  let now: number = $state(Date.now());
  let ready: boolean = $state(false);
  let busy: boolean = $state(false);
  let filter: string = $state('');
  let notice: string = $state('');

  const sorted = $derived(sortStale(rows));
  const staleRows = $derived(rows.filter((row) => isStale(row, thresholdMs, now)));
  const closable = $derived(selectClosable(rows, thresholdMs, now));
  const visible = $derived(
    filter.trim() === ''
      ? sorted
      : sorted.filter((row) =>
          (row.title + ' ' + row.url + ' ' + (row.groupTitle ?? '')).toLowerCase().includes(filter.trim().toLowerCase()),
        ),
  );

  function hostOf(url: string): string {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return '';
    }
  }

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
    thresholdMs = config.stale.staleAfterHours * 3_600_000;
    now = Date.now();
    rows = tabs
      .filter((tab) => tab.id !== undefined)
      .map((tab) => {
        const tabId = tab.id as number;
        const stat = stats[String(tabId)];
        // Chrome dates every tab it knows, including ones older than this feature.
        const lastAccessed = typeof tab.lastAccessed === 'number' && tab.lastAccessed > 0 ? tab.lastAccessed : 0;
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
          firstSeen: stat?.firstSeen ?? lastAccessed,
          lastActive: stat?.lastActive ?? lastAccessed,
        };
      });
    ready = true;
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
    const targets = selectClosable(rows, thresholdMs, Date.now()).map((row) => row.tabId);
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

  function openOptions(): void {
    void chrome.runtime.openOptionsPage();
  }
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
  <div class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
    <p class="num min-w-0 flex-1 text-[12px] text-dim">
      <span class="font-semibold {staleRows.length > 0 ? 'text-stale' : 'text-ink'}">{staleRows.length}</span>
      <span class="text-faint">stale of</span>
      {rows.length}
      {#if thresholdMs > 0}
        <span class="text-faint">· {durationLabel(thresholdMs)}+</span>
      {:else}
        <span class="text-faint">· flagging off</span>
      {/if}
    </p>
    <div class="flex h-7 w-[42%] min-w-24 items-center gap-1 rounded-md border border-line bg-overlay px-1.5 focus-within:border-line-strong">
      <Icon name="search" size={12} class="shrink-0 text-faint" />
      <input
        class="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-faint focus:outline-none"
        placeholder="Filter"
        aria-label="Filter stale tabs"
        bind:value={filter}
      />
    </div>
  </div>

  {#if notice !== ''}
    <div class="flex items-start gap-1.5 border-b border-line px-3 py-1.5 text-[11px] text-dim" role="status">
      <Icon name="check" size={12} class="mt-0.5 shrink-0 text-good" />
      <p class="min-w-0 flex-1 break-words">{notice}</p>
    </div>
  {/if}

  <ul class="min-h-0 flex-1 overflow-y-auto overscroll-contain" aria-label="Tabs by age">
    {#each visible as row (row.tabId)}
      {@const stale = isStale(row, thresholdMs, now)}
      <li class="group flex items-start gap-2 border-b border-line/70 px-3 py-2 hover:bg-raised">
        <span class="mt-0.5 shrink-0 {row.discarded ? 'text-asleep' : stale ? 'text-stale' : 'text-faint'}">
          <Icon name={row.discarded ? 'moon' : row.audible ? 'speaker' : row.pinned ? 'pin' : 'clock'} size={13} />
        </span>
        <button class="min-w-0 flex-1 text-left" title={row.url} onclick={() => void focusTab(row)}>
          <span class="block truncate text-[13px] {row.active ? 'font-semibold text-ink' : 'text-ink'}">{row.title}</span>
          <span class="num mt-0.5 flex items-center gap-1.5 text-[11px] text-dim">
            <span class={stale ? 'text-stale' : 'text-faint'}>{ageLabel(row.lastActive, now)}</span>
            {#if hostOf(row.url) !== ''}
              <span class="text-line-strong">·</span>
              <span class="min-w-0 truncate">{hostOf(row.url)}</span>
            {/if}
            {#if row.groupTitle !== null}
              <span class="text-line-strong">·</span>
              <span class="min-w-0 truncate text-faint">{row.groupTitle}</span>
            {/if}
            {#if row.pinned}<span class="text-line-strong">·</span><span class="text-faint">pinned</span>{/if}
            {#if row.audible}<span class="text-line-strong">·</span><span class="text-faint">audio</span>{/if}
          </span>
        </button>
        <button
          class="shrink-0 rounded p-0.5 text-faint opacity-0 transition-opacity duration-120 hover:text-bad focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-30"
          title="Close tab"
          aria-label="Close {row.title}"
          disabled={busy}
          onclick={() => void closeTabs([row.tabId], false)}><Icon name="close" size={13} /></button
        >
      </li>
    {/each}
  </ul>

  {#if !ready}
    <p class="px-3 py-4 text-center text-[12px] text-faint">Reading tabs…</p>
  {:else if visible.length === 0}
    <div class="px-4 py-6 text-center">
      {#if rows.length === 0}
        <p class="text-[13px] text-ink">No open tabs.</p>
        <p class="mt-1 text-[12px] text-dim">Open something and it shows up here with its age.</p>
      {:else if filter.trim() !== ''}
        <p class="text-[13px] text-ink">No tab matches “{filter.trim()}”.</p>
        <button class="mt-2 text-[12px] text-awake underline underline-offset-2" onclick={() => (filter = '')}>Clear filter</button>
      {:else if thresholdMs === 0}
        <p class="text-[13px] text-ink">Stale flagging is off.</p>
        <p class="mt-1 text-[12px] text-dim">Ages are tracked, so nothing is hidden — turn flagging on to rank them.</p>
        <button class="mt-2 text-[12px] text-awake underline underline-offset-2" onclick={openOptions}>Open settings</button>
      {:else}
        <p class="text-[13px] text-ink">Nothing stale.</p>
        <p class="mt-1 text-[12px] text-dim">No tab has gone {durationLabel(thresholdMs)} without a visit. Every row is younger.</p>
      {/if}
    </div>
  {/if}

  {#if closable.length > 0}
    <div class="rise flex shrink-0 flex-wrap items-center gap-2 border-t border-line bg-raised px-3 py-2 shadow-[0_-8px_24px_rgb(0_0_0_/_0.45)]">
      <p class="num min-w-0 flex-1 text-[11px] text-dim">
        <span class="font-semibold text-ink">{closable.length}</span> closable
        <span class="text-faint">· pinned, active, audio kept</span>
      </p>
      <button
        class="rounded-md bg-awake px-2.5 py-1.5 text-[12px] font-semibold text-on-awake hover:bg-accent-strong disabled:opacity-40"
        disabled={busy}
        onclick={() => void closeStale(true)}>{busy ? 'Working…' : 'Snapshot + close'}</button
      >
      <button
        class="rounded-md border border-bad/45 px-2.5 py-1.5 text-[12px] font-medium text-bad hover:bg-bad/10 disabled:opacity-40"
        disabled={busy}
        onclick={() => void closeStale(false)}>Close</button
      >
    </div>
  {/if}
</div>
