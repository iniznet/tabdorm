<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { sendToBackground } from '@/core/messaging';
  import { hostnamePattern } from '@/core/whitelist';
  import { getConfig, saveConfig } from '@/core/config-store';
  import Icon from '@/lib/ui/Icon.svelte';

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
    estimateSize: () => 48,
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
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  };
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex shrink-0 flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-line px-3 py-2">
    <p class="num min-w-0 flex-1 text-[12px] text-dim">
      <span class="font-semibold text-ink">{rows.length}</span>
      <span class="text-faint">in this window ·</span>
      {rows.filter((r) => r.discarded).length} asleep
    </p>
    <div class="flex h-7 min-w-0 flex-1 basis-28 items-center gap-1 rounded-md border border-line bg-overlay px-1.5 focus-within:border-line-strong">
      <Icon name="search" size={12} class="shrink-0 text-faint" />
      <input
        class="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-faint focus:outline-none"
        placeholder="Filter"
        aria-label="Filter tabs"
        bind:value={filter}
      />
    </div>
  </div>

  <div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto">
    <div class="relative w-full" style="height:{total}px">
      {#each items as row (row.key)}
        {@const tab = visible[row.index]}
        {#if tab}
          <div class="absolute left-0 w-full" style="transform:translateY({row.start}px)">
            <div
              class="group flex h-12 items-start gap-2 border-b border-line/70 px-3 py-2 {tab.active
                ? 'bg-awake/5'
                : 'hover:bg-raised'}"
            >
              <span class="mt-0.5 shrink-0 {tab.active ? 'text-awake' : tab.discarded ? 'text-asleep' : 'text-faint'}">
                <Icon name={tab.active ? 'sun' : tab.discarded ? 'moon' : 'layers'} size={13} />
              </span>
              <div class="min-w-0 flex-1">
                <p class="truncate text-[13px] {tab.active ? 'font-semibold text-ink' : 'text-ink'}" title={tab.url}>{tab.title}</p>
                <p class="num mt-0.5 flex items-center gap-1.5 text-[11px] text-dim">
                  <span class="min-w-0 truncate">{HOSTNAME(tab.url)}</span>
                  {#if tab.active}<span class="text-line-strong">·</span><span class="text-awake">focused</span>{/if}
                  {#if tab.discarded}<span class="text-line-strong">·</span><span class="text-asleep">asleep</span>{/if}
                  {#if tab.pinned}<span class="text-line-strong">·</span><span class="text-faint">pinned</span>{/if}
                  {#if isWhitelisted(tab)}<span class="text-line-strong">·</span><span class="text-good">shielded</span>{/if}
                </p>
              </div>
              <div class="flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity duration-120 focus-within:opacity-100 group-hover:opacity-100">
                {#if !tab.discarded}
                  <button
                    class="grid h-6 w-6 place-items-center rounded text-faint hover:bg-overlay hover:text-asleep disabled:opacity-30 focus-visible:opacity-100"
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
                  title={isWhitelisted(tab)
                    ? `${HOSTNAME(tab.url)} is shielded`
                    : `Never sleep ${HOSTNAME(tab.url)}`}
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

  {#if visible.length === 0}
    <div class="px-4 py-6 text-center">
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
