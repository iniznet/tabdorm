<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import type { StoredTab, StoredWindow, UnifiedSession } from '@/types';

  interface Props {
    session: UnifiedSession;
    busyId: string | null;
    onBack: () => void;
    onRestore: (session: UnifiedSession) => void;
  }

  let { session, busyId, onBack, onRestore }: Props = $props();

  interface DetailRow {
    kind: 'window' | 'tab';
    label: string;
    tab?: StoredTab;
    groupColor?: string;
  }

  const rowsData = $derived.by<DetailRow[]>(() => {
    const out: DetailRow[] = [];
    session.windows.forEach((win: StoredWindow, wi: number) => {
      const groupColors = new Map(win.groups.map((g) => [g.key, g.color]));
      out.push({ kind: 'window', label: `Window ${wi + 1} · ${win.tabs.length} tabs` });
      for (const tab of win.tabs) {
        out.push({
          kind: 'tab',
          label: tab.title === '' ? tab.url : tab.title,
          tab,
          groupColor: tab.groupKey === undefined ? undefined : groupColors.get(tab.groupKey),
        });
      }
    });
    return out;
  });

  let scrollEl: HTMLDivElement | undefined = $state();
  const virtualizer = createVirtualizer({
    get count() {
      return rowsData.length;
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 32,
    overscan: 12,
  });
  $effect(() => {
    const count = rowsData.length;
    get(virtualizer).setOptions({ count });
  });
  const rows = $derived($virtualizer.getVirtualItems());
  const total = $derived($virtualizer.getTotalSize());
  // Static class map — Tailwind cannot generate dynamic class names.
  const GROUP_DOT: Record<string, string> = {
    grey: 'bg-neutral-400',
    blue: 'bg-blue-400',
    red: 'bg-red-400',
    yellow: 'bg-yellow-400',
    green: 'bg-green-400',
    pink: 'bg-pink-400',
    purple: 'bg-purple-400',
    cyan: 'bg-cyan-400',
    orange: 'bg-orange-400',
  };

  function groupDot(color: string): string {
    return GROUP_DOT[color] ?? 'bg-neutral-400';
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="mb-1 flex items-center gap-2">
    <button
      class="rounded-md bg-neutral-800 px-2 py-1 text-xs hover:bg-neutral-700"
      onclick={onBack}>← Sessions</button
    >
    <button
      class="ml-auto rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
      disabled={busyId !== null}
      onclick={() => onRestore(session)}>
      {busyId === session.id ? 'Restoring…' : 'Restore session'}
    </button>
  </div>
  <div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/60">
    <div class="relative w-full" style="height:{total}px">
      {#each rows as row (row.key)}
        {@const item = rowsData[row.index]}
        {#if item}
          <div class="absolute left-0 w-full px-2" style="transform:translateY({row.start}px)">
            {#if item.kind === 'window'}
              <p class="py-1 text-[10px] font-semibold uppercase tracking-wide text-neutral-500">{item.label}</p>
            {:else if item.tab}
              <div class="flex h-7 items-center gap-2 rounded px-2 text-xs hover:bg-neutral-800/60">
                {#if item.groupColor}
                  <span class="h-2 w-2 shrink-0 rounded-full {groupDot(item.groupColor)}"></span>
                {/if}
                <span class="truncate text-neutral-300">{item.label}</span>
                {#if item.tab.isDiscarded}<span class="ml-auto shrink-0 text-[10px] text-neutral-600">💤</span>{/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>
</div>

