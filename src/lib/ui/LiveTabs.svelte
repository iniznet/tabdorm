<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { getActivitySnapshot } from '@/core/activity';
  import { matchesUrlPattern } from '@/core/auto-route';
  import { sendToBackground } from '@/core/messaging';
  import { classifyTabState, SLEEP_CLOCK_TICK_MS, type TabState, type TabStateKind } from '@/core/tab-state';
  import { hostnamePattern } from '@/core/whitelist';
  import { getConfig, saveConfig } from '@/core/config-store';
  import Icon from '@/lib/ui/Icon.svelte';

  interface LiveRow {
    tabId: number;
    title: string;
    url: string;
    active: boolean;
    pinned: boolean;
    audible: boolean;
    discarded: boolean;
    /** false when a shield (autoDiscardable off) forbids discarding this tab. */
    autoDiscardable: boolean;
    groupId: number;
  }

  interface GroupMeta {
    title: string;
    color: string;
    index: number;
  }

  type Item =
    | { kind: 'header'; key: string; label: string; color: string; count: number }
    | { kind: 'row'; key: string; row: LiveRow };

  interface Props {
    onStats?: (total: number, asleep: number) => void;
  }

  let { onStats }: Props = $props();

  const GROUP_NONE = -1;

  let rows: LiveRow[] = $state([]);
  let groups = $state<Map<number, GroupMeta>>(new Map());
  let filter = $state('');
  let scrollEl: HTMLDivElement | undefined = $state();
  let suspendingId: number | null = $state(null);
  let whitelistPatterns: string[] = $state([]);
  let thresholdMs: number = $state(0);
  let pinnedExempt: boolean = $state(true);
  let audibleExempt: boolean = $state(true);
  /** Per-tab idle clocks from storage.session; unknown ids fall back to "awake". */
  let activity: Record<string, number> = $state({});
  let now: number = $state(Date.now());

  const filtered = $derived(
    filter.trim() === ''
      ? rows
      : rows.filter((r) => (r.title + ' ' + r.url).toLowerCase().includes(filter.trim().toLowerCase())),
  );

  /**
   * Chrome's own grouping is preserved: one section per tab group in the browser's
   * group order, ungrouped tabs last. Filtering narrows rows inside a section and
   * drops a section only when nothing in it matches.
   */
  const items = $derived.by<Item[]>(() => {
    const buckets = new Map<number, LiveRow[]>();
    for (const row of filtered) {
      const list = buckets.get(row.groupId);
      if (list === undefined) buckets.set(row.groupId, [row]);
      else list.push(row);
    }
    const order = [...buckets.keys()].sort((a, b) => {
      if (a === GROUP_NONE) return 1;
      if (b === GROUP_NONE) return -1;
      return (groups.get(a)?.index ?? 0) - (groups.get(b)?.index ?? 0);
    });
    const out: Item[] = [];
    for (const groupId of order) {
      const list = buckets.get(groupId) ?? [];
      if (groupId === GROUP_NONE) {
        if (order.length > 1) out.push({ kind: 'header', key: 'h-none', label: 'Ungrouped', color: '', count: list.length });
      } else {
        const meta = groups.get(groupId);
        out.push({
          kind: 'header',
          key: 'h-' + String(groupId),
          label: meta === undefined || meta.title === '' ? 'Group' : meta.title,
          color: meta?.color ?? 'grey',
          count: list.length,
        });
      }
      for (const row of list) out.push({ kind: 'row', key: 'r-' + String(row.tabId), row });
    }
    return out;
  });

  const virtualizer = createVirtualizer({
    get count() {
      return items.length;
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: (index) => (items[index]?.kind === 'header' ? 28 : 48),
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 10,
  });
  $effect(() => {
    const count = items.length;
    get(virtualizer).setOptions({ count });
  });

  let lastScrolledActiveId: number | null = null;
  $effect(() => {
    const index = items.findIndex((item) => item.kind === 'row' && item.row.active);
    if (index === -1) return;
    const item = items[index];
    if (item === undefined || item.kind !== 'row' || item.row.tabId === lastScrolledActiveId) return;
    lastScrolledActiveId = item.row.tabId;
    get(virtualizer).scrollToIndex(index, { align: 'auto' });
  });

  const virtualItems = $derived($virtualizer.getVirtualItems());
  const total = $derived($virtualizer.getTotalSize());

  onMount(() => {
    void refresh();
    // Countdowns stay honest while the panel is open; the tick is display-only.
    const tick = setInterval(() => {
      now = Date.now();
    }, SLEEP_CLOCK_TICK_MS);
    const onChange = () => void refresh();
    chrome.tabs.onUpdated.addListener(onChange);
    chrome.tabs.onRemoved.addListener(onChange);
    chrome.tabs.onCreated.addListener(onChange);
    chrome.tabGroups.onUpdated?.addListener(onChange);
    chrome.tabGroups.onCreated?.addListener(onChange);
    chrome.tabGroups.onRemoved?.addListener(onChange);
    return () => {
      clearInterval(tick);
      chrome.tabs.onUpdated.removeListener(onChange);
      chrome.tabs.onRemoved.removeListener(onChange);
      chrome.tabs.onCreated.removeListener(onChange);
      chrome.tabGroups.onUpdated?.removeListener(onChange);
      chrome.tabGroups.onCreated?.removeListener(onChange);
      chrome.tabGroups.onRemoved?.removeListener(onChange);
    };
  });

  async function refresh(): Promise<void> {
    const win = await chrome.windows.getLastFocused();
    if (win.id === undefined) return;
    const [tabs, tabGroups, config, activityMap] = await Promise.all([
      chrome.tabs.query({ windowId: win.id }),
      chrome.tabGroups.query({ windowId: win.id }),
      getConfig(),
      // A failed clock read degrades every row to "awake"; it never blanks the list.
      getActivitySnapshot().catch((error: unknown) => {
        console.warn('[tabdorm] activity snapshot unavailable.', error);
        return {} as Record<string, number>;
      }),
    ]);
    const nextGroups = new Map<number, GroupMeta>();
    // tabGroups.query returns groups in browser strip order; that order is the index.
    tabGroups.forEach((group, position) => {
      nextGroups.set(group.id, { title: group.title ?? '', color: group.color ?? 'grey', index: position });
    });
    groups = nextGroups;
    rows = tabs
      .filter((t) => t.id !== undefined)
      .map((t) => ({
        tabId: t.id as number,
        title: t.title === '' || t.title === undefined ? (t.url ?? '') : t.title,
        url: t.url ?? t.pendingUrl ?? '',
        active: t.active === true,
        pinned: t.pinned === true,
        audible: t.audible === true,
        discarded: t.discarded === true,
        autoDiscardable: t.autoDiscardable !== false,
        groupId: t.groupId === undefined ? GROUP_NONE : t.groupId,
      }));
    onStats?.(rows.length, rows.filter((r) => r.discarded).length);
    now = Date.now();
    activity = activityMap;
    whitelistPatterns = config.suspension.exemptions.urlPatterns;
    thresholdMs = config.suspension.idleThresholdMinutes * 60_000;
    pinnedExempt = config.suspension.exemptions.pinnedTabs;
    audibleExempt = config.suspension.exemptions.audibleTabs;
  }

  async function suspend(tabId: number): Promise<void> {
    suspendingId = tabId;
    await sendToBackground({ type: 'suspendTab', tabId });
    suspendingId = null;
    await refresh();
  }

  /** Closes every non-pinned tab sharing the row's hostname in this window, including the row itself. */
  async function closeRelated(tab: LiveRow): Promise<void> {
    const host = HOSTNAME(tab.url);
    const related = rows.filter((r) => !r.pinned && HOSTNAME(r.url) === host);
    if (related.length <= 1) {
      await closeTab(tab.tabId);
      return;
    }
    if (!window.confirm(`Close ${related.length} "${host}" tabs?`)) return;
    try {
      await chrome.tabs.remove(related.map((r) => r.tabId));
    } catch {
      // Some tabs may already be gone — the change listeners refresh the list.
    }
    await refresh();
  }

  async function closeTab(tabId: number): Promise<void> {
    try {
      await chrome.tabs.remove(tabId);
    } catch {
      // Tab already gone — the onRemoved listener refreshes the list.
    }
    await refresh();
  }

  /** Adds the tab's hostname to the suspension whitelist (idempotent). */
  async function whitelist(tab: LiveRow): Promise<void> {
    const pattern = hostnamePattern(tab.url);
    if (pattern === null || whitelistPatterns.includes(pattern)) return;
    const config = await getConfig();
    const draft = structuredClone(config);
    draft.suspension.exemptions.urlPatterns = [...draft.suspension.exemptions.urlPatterns, pattern];
    await saveConfig(draft);
    whitelistPatterns = draft.suspension.exemptions.urlPatterns;
  }

  function isWhitelisted(tab: LiveRow): boolean {
    return matchesUrlPattern(tab.url, whitelistPatterns);
  }

  /** The row's sleep state — always from the shared classifier, never re-derived here. */
  function stateFor(tab: LiveRow): TabState {
    return classifyTabState({
      active: tab.active,
      discarded: tab.discarded,
      pinned: tab.pinned,
      audible: tab.audible,
      autoDiscardable: tab.autoDiscardable,
      url: tab.url,
      urlPatterns: whitelistPatterns,
      exemptions: { pinnedTabs: pinnedExempt, audibleTabs: audibleExempt },
      lastActivityAt: activity[String(tab.tabId)] ?? 0,
      now,
      idleThresholdMs: thresholdMs,
    });
  }

  const STATE_ICON: Record<TabStateKind, 'sun' | 'moon' | 'zzz' | 'shield'> = {
    active: 'sun',
    awake: 'moon',
    due: 'moon',
    asleep: 'zzz',
    protected: 'shield',
  };

  /** Temperature carries meaning: amber awake, rust ageing, moonlight asleep, green protected. */
  const STATE_TONE: Record<TabStateKind, string> = {
    active: 'text-awake',
    awake: 'text-faint',
    due: 'text-stale',
    asleep: 'text-asleep',
    protected: 'text-good',
  };

  /** Chrome's group colours, on our palette's terms. */
  const GROUP_DOT: Record<string, string> = {
    grey: 'bg-faint',
    blue: 'bg-asleep',
    cyan: 'bg-asleep',
    green: 'bg-good',
    yellow: 'bg-awake',
    orange: 'bg-stale',
    red: 'bg-bad',
    pink: 'bg-stale',
    purple: 'bg-awake',
  };

  const HOSTNAME = (url: string): string => {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };
</script>

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
  <div class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
    <p class="num min-w-0 flex-1 truncate text-[12px] text-dim">
      <span class="font-semibold text-ink">{rows.length}</span>
      <span class="text-faint">in this window ·</span>
      {rows.filter((r) => r.discarded).length} asleep
    </p>
    <div
      class="flex h-7 w-[42%] min-w-24 items-center gap-1 rounded-md border border-line bg-overlay px-1.5 focus-within:border-line-strong"
    >
      <Icon name="search" size={12} class="shrink-0 text-faint" />
      <input
        class="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-faint focus:outline-none"
        placeholder="Filter"
        aria-label="Filter tabs"
        bind:value={filter}
      />
    </div>
  </div>

  <div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    <div class="relative w-full" style="height:{total}px">
      {#each virtualItems as entry (entry.key)}
        {@const item = items[entry.index]}
        {#if item?.kind === 'header'}
          <div class="absolute left-0 w-full" style="transform:translateY({entry.start}px)">
            <div class="flex h-7 items-center gap-1.5 border-b border-line/60 bg-raised px-3">
              {#if item.color !== ''}
                <span class="h-1.5 w-1.5 shrink-0 rounded-full {GROUP_DOT[item.color] ?? 'bg-faint'}"></span>
              {/if}
              <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-dim" title={item.label}>{item.label}</span>
              <span class="num shrink-0 text-[10px] text-faint">{item.count}</span>
            </div>
          </div>
        {:else if item?.kind === 'row'}
          {@const tab = item.row}
          {@const state = stateFor(tab)}
          <div class="absolute left-0 w-full" style="transform:translateY({entry.start}px)">
            <div
              class="group flex h-12 items-start gap-2 border-b border-line/70 px-3 py-2 {tab.active
                ? 'bg-awake/5'
                : 'hover:bg-raised'}"
            >
              <span class="mt-0.5 shrink-0 {STATE_TONE[state.kind]}" title={state.label}>
                <Icon name={STATE_ICON[state.kind]} size={13} />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13px] {tab.active ? 'font-semibold text-ink' : 'text-ink'}" title={tab.url}>{tab.title}</p>
                <p class="num mt-0.5 flex items-center gap-1.5 text-[11px] text-dim">
                  <span class="min-w-0 truncate">{HOSTNAME(tab.url)}</span>
                  <span class="text-line-strong">·</span>
                  <span class="{STATE_TONE[state.kind]} shrink-0">{state.label}</span>
                  {#if tab.pinned && state.protection !== 'pinned'}
                    <span class="text-line-strong">·</span><span class="text-faint">pinned</span>
                  {/if}
                </p>
              </div>
              <div
                class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover:opacity-100"
              >
                {#if !tab.discarded}
                  <button
                    class="grid h-6 w-6 place-items-center rounded text-faint hover:bg-overlay hover:text-asleep focus-visible:opacity-100 disabled:opacity-30"
                    disabled={tab.active || suspendingId !== null}
                    title={tab.active ? 'The focused tab cannot be suspended' : 'Put this tab to sleep'}
                    aria-label="Put this tab to sleep"
                    onclick={() => void suspend(tab.tabId)}><Icon name="moon" size={13} /></button
                  >
                {/if}
                <button
                  class="grid h-6 w-6 place-items-center rounded hover:bg-overlay {isWhitelisted(tab)
                    ? 'text-good'
                    : 'text-faint hover:text-ink'}"
                  disabled={tab.discarded || isWhitelisted(tab)}
                  title={isWhitelisted(tab) ? `${HOSTNAME(tab.url)} is shielded` : `Never sleep ${HOSTNAME(tab.url)}`}
                  aria-label="Shield this site from sleeping"
                  onclick={() => void whitelist(tab)}><Icon name="shield" size={13} /></button
                >
                <button
                  class="grid h-6 w-6 place-items-center rounded text-faint hover:bg-overlay hover:text-ink"
                  title={tab.pinned ? 'Pinned tab' : `Close every ${HOSTNAME(tab.url)} tab here`}
                  aria-label="Close every tab from this site"
                  onclick={() => void closeRelated(tab)}><Icon name="copy" size={13} /></button
                >
                <button
                  class="grid h-6 w-6 place-items-center rounded text-faint hover:bg-overlay hover:text-bad"
                  title="Close tab"
                  aria-label="Close tab"
                  onclick={() => void closeTab(tab.tabId)}><Icon name="close" size={13} /></button
                >
              </div>
            </div>
          </div>
        {/if}
      {/each}
    </div>
  </div>

  {#if filtered.length === 0}
    <div class="shrink-0 px-4 py-6 text-center">
      {#if rows.length === 0}
        <p class="text-[13px] text-ink">No tabs in the focused window.</p>
        <p class="mt-1 text-[12px] text-dim">Click into a window and its tabs appear here.</p>
      {:else}
        <p class="text-[13px] text-ink">No tab matches “{filter.trim()}”.</p>
        <button class="mt-2 text-[12px] text-awake underline underline-offset-2" onclick={() => (filter = '')}>Clear filter</button>
      {/if}
    </div>
  {/if}
</div>
