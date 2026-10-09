<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { putSession } from '@/core/db';
  import { parseImportedSession } from '@/core/session-import';
  import type { UnifiedSession } from '@/types';

  interface Props {
    sessions: UnifiedSession[];
    busyId: string | null;
    hasMore: boolean;
    loading: boolean;
    onSelect: (session: UnifiedSession) => void;
    onRestore: (session: UnifiedSession) => void;
    onDelete: (session: UnifiedSession) => void;
    onLoadMore: () => void;
    onImported: () => void;
  }

  let { sessions, busyId, hasMore, loading, onSelect, onRestore, onDelete, onLoadMore, onImported }: Props = $props();

  let scrollEl: HTMLDivElement | undefined = $state();
  let query = $state('');
  let menuFor: string | null = $state(null);

  const visible = $derived(
    query.trim() === ''
      ? sessions
      : sessions.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  const virtualizer = createVirtualizer({
    get count() {
      return visible.length;
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: () => 68,
    overscan: 8,
  });

  // Keep the virtualizer's item count in lockstep with filtered, paginated data.
  $effect(() => {
    const count = visible.length;
    get(virtualizer).setOptions({ count });
  });

  const rows = $derived($virtualizer.getVirtualItems());
  const total = $derived($virtualizer.getTotalSize());

  function formatWhenLong(ts: number): string {
    return new Date(ts).toLocaleString();
  }

  function typeBadge(type: UnifiedSession['type']): string {
    if (type === 'closed_window') return 'closed';
    if (type === 'auto_snapshot') return 'auto';
    return 'saved';
  }

  let importInput: HTMLInputElement | undefined = $state();
  let importError = $state<string | null>(null);

  async function importSession(file: File): Promise<void> {
    importError = null;
    try {
      await putSession(parseImportedSession(await file.text()));
      onImported();
    } catch (error) {
      importError = error instanceof Error ? error.message : String(error);
    }
  }

  function exportSession(session: UnifiedSession): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tabdorm-session-${session.name.replace(/[^\w.-]+/g, '_')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const BADGE: Record<UnifiedSession['type'], string> = {
    user_saved: 'bg-good/15 text-good',
    closed_window: 'bg-warn/15 text-warn',
    auto_snapshot: 'bg-overlay text-faint',
  };
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="relative mb-1">
    <input
      class="w-full rounded-md border border-line bg-overlay px-2.5 py-1 pr-7 text-xs text-ink placeholder:text-faint"
      placeholder="Filter loaded sessions…"
      bind:value={query}
    />
    {#if query !== ''}
      <button
        class="absolute right-1.5 top-1/2 -translate-y-1/2 text-xs text-faint hover:text-ink"
        aria-label="Clear session filter"
        onclick={() => (query = '')}>✕</button
      >
    {/if}
  </div>
  <div class="mb-1 flex items-center gap-2">
    <button class="text-[11px] text-dim hover:text-ink" onclick={() => importInput?.click()}>⤓ Import session file…</button>
    <input
      bind:this={importInput}
      type="file"
      accept="application/json,.json"
      class="hidden"
      onchange={(e) => {
        const file = e.currentTarget.files?.[0];
        if (file !== undefined) void importSession(file);
        e.currentTarget.value = '';
      }}
    />
    {#if importError !== null}
      <span class="text-[11px] text-bad">{importError}</span>
    {/if}
  </div>
  <div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-raised/60">
    <div class="relative w-full" style="height:{total}px">
      {#each rows as row (row.key)}
        {@const session = visible[row.index]}
        {#if session}
          <div class="absolute left-0 w-full px-1.5 pb-1.5" style="transform:translateY({row.start}px)">
            <div
              class="relative flex h-[60px] items-center justify-between gap-2 rounded-lg border border-line bg-overlay px-3 hover:border-faint/60">
              <button class="min-w-0 flex-1 text-left" onclick={() => onSelect(session)}>
                <p class="truncate text-sm font-medium text-ink">{session.name}</p>
                <p class="mt-0.5 flex items-center gap-1.5 text-[11px] text-dim">
                  <span class="rounded px-1 py-0.5 text-[10px] font-medium uppercase {BADGE[session.type]}">{typeBadge(session.type)}</span>
                  <span class="truncate">{formatWhenLong(session.timestamp)} · {session.windows.length} window(s) · {session.windows.reduce((n, w) => n + w.tabs.length, 0)} tabs</span>
                </p>
              </button>
              <button
                class="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-50"
                disabled={busyId !== null}
                onclick={() => onRestore(session)}>
                {busyId === session.id ? 'Restoring…' : 'Restore'}
              </button>
              <button
                class="grid h-6 w-6 shrink-0 place-items-center rounded text-dim hover:bg-line hover:text-ink"
                aria-label="Session actions"
                aria-expanded={menuFor === session.id}
                onclick={(e) => {
                  e.stopPropagation();
                  menuFor = menuFor === session.id ? null : session.id;
                }}>⋯</button
              >
              {#if menuFor === session.id}
                <div
                  class="absolute right-2 top-[52px] z-10 w-40 rounded-lg border border-line bg-raised py-1 shadow-xl shadow-black/40">
                  <button
                    class="block w-full px-3 py-1.5 text-left text-xs text-dim hover:bg-overlay hover:text-ink"
                    onclick={(e) => {
                      e.stopPropagation();
                      menuFor = null;
                      onSelect(session);
                    }}>Details & rename</button
                  >
                  <button
                    class="block w-full px-3 py-1.5 text-left text-xs text-dim hover:bg-overlay hover:text-ink"
                    onclick={(e) => {
                      e.stopPropagation();
                      menuFor = null;
                      exportSession(session);
                    }}>Export JSON</button
                  >
                  <button
                    class="block w-full px-3 py-1.5 text-left text-xs text-bad hover:bg-overlay"
                    onclick={(e) => {
                      e.stopPropagation();
                      menuFor = null;
                      onDelete(session);
                    }}>Delete</button
                  >
                </div>
              {/if}
            </div>
          </div>
        {/if}
      {/each}
    </div>
    {#if hasMore && query.trim() === ''}
      <div class="p-2 text-center">
        <button
          class="w-full rounded-md border border-line py-1.5 text-xs text-dim hover:border-faint hover:text-ink disabled:opacity-50"
          disabled={loading}
          onclick={onLoadMore}>Load more</button
        >
      </div>
    {:else if visible.length === 0}
      <p class="p-4 text-center text-xs text-faint">
        {sessions.length === 0
          ? 'No sessions yet. Use “Snapshot now” or close a window to capture one.'
          : 'No loaded sessions match that filter.'}
      </p>
    {/if}
  </div>
</div>
