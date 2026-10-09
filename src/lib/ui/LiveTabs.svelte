<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { sendToBackground } from '@/core/messaging';
  import { hostnamePattern } from '@/core/whitelist';
  import { getConfig, saveConfig } from '@/core/config-store';

  interface LiveRow {
    tabId: number;
    title: string;
    url: string;
    active: boolean;
    pinned: boolean;
    discarded: boolean;
  }

  interface Props {
    onStats?: (total: number, asleep: number) => void;
  }

  let { onStats }: Props = $props();

  let rows: LiveRow[] = $state([]);
  let filter = $state('');
  let scrollEl: HTMLDivElement | undefined = $state();
  let suspendingId: number | null = $state(null);
  let whitelistedHosts: string[] = $state([]);

  const visible = $derived(
    filter.trim() === ''
      ? rows
      : rows.filter((r) => (r.title + ' ' + r.url).toLowerCase().includes(filter.trim().toLowerCase())),
  );

  const virtualizer = createVirtualizer({
    get count() {
      return visible.length;
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 28,
    overscan: 10,
  });
  $effect(() => {
    const count = visible.length;
    get(virtualizer).setOptions({ count });
  });
  let lastScrolledActiveId: number | null = null;
  $effect(() => {
    const activeIndex = visible.findIndex((r) => r.active);
    if (activeIndex === -1) return;
    const row = visible[activeIndex];
    if (row === undefined || row.tabId === lastScrolledActiveId) return;
    lastScrolledActiveId = row.tabId;
    get(virtualizer).scrollToIndex(activeIndex, { align: 'auto' });
  });
  const items = $derived($virtualizer.getVirtualItems());
  const total = $derived($virtualizer.getTotalSize());

  onMount(() => {
    void refresh();
    const onChange = () => void refresh();
    chrome.tabs.onUpdated.addListener(onChange);
    chrome.tabs.onRemoved.addListener(onChange);
    chrome.tabs.onCreated.addListener(onChange);
    return () => {
      chrome.tabs.onUpdated.removeListener(onChange);
      chrome.tabs.onRemoved.removeListener(onChange);
      chrome.tabs.onCreated.removeListener(onChange);
    };
  });

  async function refresh(): Promise<void> {
    const win = await chrome.windows.getLastFocused();
    if (win.id === undefined) return;
    const tabs = await chrome.tabs.query({ windowId: win.id });
    rows = tabs
      .filter((t) => t.id !== undefined)
      .map((t) => ({
        tabId: t.id as number,
        title: t.title === '' || t.title === undefined ? (t.url ?? '') : t.title,
        url: t.url ?? t.pendingUrl ?? '',
        active: t.active === true,
        pinned: t.pinned === true,
        discarded: t.discarded === true,
      }));
    onStats?.(rows.length, rows.filter((r) => r.discarded).length);
    const config = await getConfig();
    whitelistedHosts = config.suspension.exemptions.urlPatterns;
  }

  async function suspend(tabId: number): Promise<void> {
    suspendingId = tabId;
    await sendToBackground({ type: 'suspendTab', tabId });
    suspendingId = null;
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
    if (pattern === null || whitelistedHosts.includes(pattern)) return;
    const config = await getConfig();
    const draft = structuredClone(config);
    draft.suspension.exemptions.urlPatterns = [...draft.suspension.exemptions.urlPatterns, pattern];
    await saveConfig(draft);
    whitelistedHosts = draft.suspension.exemptions.urlPatterns;
  }

  function isWhitelisted(tab: LiveRow): boolean {
    const pattern = hostnamePattern(tab.url);
    return pattern !== null && whitelistedHosts.includes(pattern);
  }

  const HOSTNAME = (url: string): string => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="relative mb-1">
    <input
      class="w-full rounded-md border border-line bg-overlay px-2.5 py-1 pr-7 text-xs text-ink placeholder:text-faint"
      placeholder="Filter tabs…"
      bind:value={filter}
    />
    {#if filter !== ''}
      <button
        class="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-faint hover:text-ink"
        aria-label="Clear filter"
        onclick={() => (filter = '')}>✕</button
      >
    {/if}
  </div>
  <div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-raised/60">
    <div class="relative w-full" style="height:{total}px">
      {#each items as row (row.key)}
        {@const tab = visible[row.index]}
        {#if tab}
          <div class="absolute left-0 w-full px-1.5" style="transform:translateY({row.start}px)">
            <div
              class="group flex h-7 items-center gap-1.5 rounded px-1.5 text-xs {tab.active
                ? 'bg-accent/10'
                : 'hover:bg-overlay'}"
            >
              {#if tab.discarded}<span class="shrink-0 text-[10px]" title="Natively discarded — memory freed">💤</span>{/if}
              <span
                class="min-w-0 flex-1 cursor-default truncate {tab.active
                  ? 'font-semibold text-ink'
                  : 'text-dim'}"
                title={tab.url}>{tab.title}</span
              >
              {#if tab.pinned}<span class="shrink-0 text-[10px] text-faint" title="Pinned">📌</span>{/if}
              {#if tab.discarded}
                <span
                  class="shrink-0 rounded bg-overlay px-1.5 py-0.5 text-[10px] text-faint group-hover:hidden">Asleep</span
                >
              {:else}
                <button
                  class="shrink-0 rounded px-1.5 py-0.5 text-[10px] text-dim hover:bg-line hover:text-ink disabled:opacity-40"
                  disabled={tab.active || suspendingId !== null}
                  title={tab.active ? 'The focused tab cannot be suspended' : 'Discard this tab now'}
                  onclick={() => void suspend(tab.tabId)}>Suspend</button
                >
              {/if}
              <button
                class="shrink-0 grid h-5 w-5 place-items-center rounded text-[10px] {isWhitelisted(tab)
                  ? 'text-good'
                  : 'text-faint opacity-0 group-hover:opacity-100 hover:bg-line hover:text-ink'}"
                disabled={tab.discarded || isWhitelisted(tab)}
                title={isWhitelisted(tab)
                  ? `${HOSTNAME(tab.url)} is whitelisted`
                  : `Never suspend ${HOSTNAME(tab.url)}`}
                onclick={() => void whitelist(tab)}>🛡</button
              >
              <button
                class="shrink-0 grid h-5 w-5 place-items-center rounded text-[10px] text-faint opacity-0 group-hover:opacity-100 hover:bg-line hover:text-bad"
                title="Close tab"
                onclick={() => void closeTab(tab.tabId)}>✕</button
              >
            </div>
          </div>
        {/if}
      {/each}
    </div>
    {#if visible.length === 0}
      <p class="p-3 text-center text-xs text-faint">
        {rows.length === 0 ? 'No tabs in the last focused window.' : 'No tabs match that filter.'}
      </p>
    {/if}
  </div>
</div>
