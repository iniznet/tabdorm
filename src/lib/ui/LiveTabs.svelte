<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { onMount } from 'svelte';
  import { sendToBackground } from '@/core/messaging';

  interface LiveRow {
    tabId: number;
    title: string;
    url: string;
    active: boolean;
    pinned: boolean;
    discarded: boolean;
  }

  let rows: LiveRow[] = $state([]);
  let scrollEl: HTMLDivElement | undefined = $state();
  let suspendingId: number | null = $state(null);

  const virtualizer = createVirtualizer({
    get count() {
      return rows.length;
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 32,
    overscan: 10,
  });
  $effect(() => {
    const count = rows.length;
    get(virtualizer).setOptions({ count });
  });
  const items = $derived($virtualizer.getVirtualItems());
  const total = $derived($virtualizer.getTotalSize());

  onMount(() => {
    void load();
    const onChange = () => void load();
    chrome.tabs.onUpdated.addListener(onChange);
    chrome.tabs.onRemoved.addListener(onChange);
    chrome.tabs.onCreated.addListener(onChange);
    return () => {
      chrome.tabs.onUpdated.removeListener(onChange);
      chrome.tabs.onRemoved.removeListener(onChange);
      chrome.tabs.onCreated.removeListener(onChange);
    };
  });

  async function load(): Promise<void> {
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
  }

  async function suspend(tabId: number): Promise<void> {
    suspendingId = tabId;
    await sendToBackground({ type: 'suspendTab', tabId });
    suspendingId = null;
    await load();
  }
</script>

<div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/60">
  <div class="relative w-full" style="height:{total}px">
    {#each items as row (row.key)}
      {@const tab = rows[row.index]}
      {#if tab}
        <div class="absolute left-0 w-full px-2" style="transform:translateY({row.start}px)">
          <div class="flex h-7 items-center gap-2 rounded px-2 text-xs hover:bg-neutral-800/60">
            {#if tab.discarded}<span class="shrink-0 text-[10px] text-neutral-600">💤</span>{/if}
            <span class="truncate {tab.active ? 'font-semibold text-neutral-100' : 'text-neutral-300'}">{tab.title}</span>
            {#if tab.pinned}<span class="shrink-0 text-[10px] text-neutral-500">📌</span>{/if}
            <button
              class="ml-auto shrink-0 rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300 hover:bg-neutral-700 disabled:opacity-40"
              disabled={tab.active || tab.discarded || suspendingId !== null}
              title={tab.active ? 'The focused tab cannot be suspended' : 'Discard this tab'}
              onclick={() => void suspend(tab.tabId)}>
              {tab.discarded ? 'Sleeping' : 'Suspend'}
            </button>
          </div>
        </div>
      {/if}
    {/each}
  </div>
  {#if rows.length === 0}
    <p class="p-3 text-center text-xs text-neutral-500">No tabs in the last focused window.</p>
  {/if}
</div>
