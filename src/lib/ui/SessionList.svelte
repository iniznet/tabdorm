<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import type { UnifiedSession } from '@/types';

  interface Props {
    sessions: UnifiedSession[];
    busyId: string | null;
    hasMore: boolean;
    loading: boolean;
    onSelect: (session: UnifiedSession) => void;
    onRestore: (session: UnifiedSession) => void;
    onLoadMore: () => void;
  }

  let { sessions, busyId, hasMore, loading, onSelect, onRestore, onLoadMore }: Props = $props();

  let scrollEl: HTMLDivElement | undefined = $state();

  const virtualizer = createVirtualizer({
    get count() {
      return sessions.length;
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 68,
    overscan: 8,
  });

  // Keep the virtualizer's item count in lockstep with paginated data.
  $effect(() => {
    const count = sessions.length;
    get(virtualizer).setOptions({ count });
  });

  const rows = $derived($virtualizer.getVirtualItems());
  const total = $derived($virtualizer.getTotalSize());

  // Formatting kept out of the hot path so virtualizer rows stay cheap.
  function formatWhenLong(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function typeBadge(type: UnifiedSession['type']): string {
    if (type === 'closed_window') return 'closed';
    if (type === 'auto_snapshot') return 'auto';
    return 'saved';
  }
</script>

<div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-neutral-800 bg-neutral-900/60">
  <div class="relative w-full" style="height:{total}px">
    {#each rows as row (row.key)}
      {@const session = sessions[row.index]}
      {#if session}
        <div
          class="absolute left-0 w-full px-2 pb-2"
          style="transform:translateY({row.start}px)"
        >
          <div
            class="flex h-[60px] items-center justify-between gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-3"
          >
            <button class="min-w-0 flex-1 text-left" onclick={() => onSelect(session)}>
              <p class="truncate font-medium text-neutral-100">{session.name}</p>
              <p class="text-xs text-neutral-400">
                <span
                  class="mr-1 inline-block rounded px-1 py-0.5 text-[10px] uppercase {session.type === 'user_saved'
                    ? 'bg-emerald-900/60 text-emerald-300'
                    : session.type === 'closed_window'
                      ? 'bg-amber-900/60 text-amber-300'
                      : 'bg-neutral-800 text-neutral-400'}">{typeBadge(session.type)}</span
                >
                {formatWhenLong(session.timestamp)} · {session.windows.length} window(s) · {session.windows.reduce((n, w) => n + w.tabs.length, 0)} tabs
              </p>
            </button>
            <button
              class="shrink-0 rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
              disabled={busyId !== null}
              onclick={() => onRestore(session)}>
              {busyId === session.id ? 'Restoring…' : 'Restore'}
            </button>
          </div>
        </div>
      {/if}
    {/each}
  </div>
  {#if hasMore}
    <div class="p-2 text-center">
      <button
        class="w-full rounded-md bg-neutral-800 py-1.5 text-xs text-neutral-300 hover:bg-neutral-700 disabled:opacity-50"
        disabled={loading}
        onclick={onLoadMore}>Load more</button
      >
    </div>
  {:else if sessions.length === 0}
    <p class="p-4 text-center text-xs text-neutral-500">No sessions yet. Use “Snapshot now” or close a window to capture one.</p>
  {/if}
</div>
