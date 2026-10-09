<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import type { StoredTab, StoredWindow, UnifiedSession } from '@/types';
  import type { RestoreDestination, RestoreSelectionEntry } from '@/types/messages';

  interface Props {
    session: UnifiedSession;
    busyId: string | null;
    onBack: () => void;
    onRestore: (session: UnifiedSession, options?: { destination?: RestoreDestination; selection?: RestoreSelectionEntry[] }) => void;
    onRename: (session: UnifiedSession, name: string) => void;
    onDelete: (session: UnifiedSession) => void;
  }

  let { session, busyId, onBack, onRestore, onRename, onDelete }: Props = $props();

  /** Position keys of cherry-picked tabs: "windowIndex:tabIndex". */
  let picked = $state(new Set<string>());
  let destination = $state<RestoreDestination>('original');

  interface DetailRow {
    kind: 'window' | 'tab';
    label: string;
    url?: string;
    tab?: StoredTab;
    groupColor?: string;
    windowIndex?: number;
    tabIndex?: number;
  }

  const rowsData = $derived.by<DetailRow[]>(() => {
    const out: DetailRow[] = [];
    session.windows.forEach((win: StoredWindow, wi: number) => {
      const groupColors = new Map(win.groups.map((g) => [g.key, g.color]));
      out.push({ kind: 'window', label: `Window ${wi + 1} · ${win.tabs.length} tabs` });
      for (const [ti, tab] of win.tabs.entries()) {
        out.push({
          kind: 'tab',
          label: tab.title === '' ? tab.url : tab.title,
          url: tab.url,
          tab,
          groupColor: tab.groupKey === undefined ? undefined : groupColors.get(tab.groupKey),
          windowIndex: wi,
          tabIndex: ti,
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
    estimateSize: () => 26,
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

  function commitRename(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    const trimmed = input.value.trim();
    if (trimmed === '' || trimmed === session.name) {
      input.value = session.name;
      return;
    }
    onRename(session, trimmed);
  }

  function togglePick(windowIndex: number, tabIndex: number): void {
    const key = `${windowIndex}:${tabIndex}`;
    const next = new Set(picked);
    if (next.has(key)) next.delete(key);
    else next.add(key);
    picked = next;
  }

  function restoreSelected(): void {
    const selection: RestoreSelectionEntry[] = [];
    for (const key of picked) {
      const parts = key.split(':');
      const windowIndex = Number(parts[0]);
      const tabIndex = Number(parts[1]);
      if (Number.isInteger(windowIndex) && Number.isInteger(tabIndex)) {
        selection.push({ windowIndex, tabIndex });
      }
    }
    onRestore(session, { destination, selection });
  }

  function exportSession(): void {
    const url = URL.createObjectURL(new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `tabdorm-session-${session.name.replace(/[^\w.-]+/g, '_')}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  const BTN = 'rounded-md border border-line px-2 py-1 text-xs text-dim hover:border-faint hover:text-ink disabled:opacity-50';
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="mb-1.5 flex items-center gap-1.5">
    <button class="shrink-0 rounded-md border border-line px-2 py-1 text-xs text-dim hover:border-faint hover:text-ink" onclick={onBack}>←</button>
    <input
      class="min-w-0 flex-1 rounded-md border border-transparent bg-transparent px-1.5 py-1 text-sm font-medium text-ink hover:border-line focus:border-accent"
      value={session.name}
      onchange={commitRename}
      onkeydown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
      aria-label="Session name"
      title="Click to rename"
    />
    <button class={BTN} onclick={exportSession}>Export</button>
    <select
      class="rounded-md border border-line bg-overlay px-1.5 py-1 text-xs text-dim"
      bind:value={destination}
      title="Where the restored tabs go"
      aria-label="Restore destination">
      <option value="original">Original windows</option>
      <option value="single">One new window</option>
      <option value="current">Current window</option>
    </select>
    <button class={BTN} disabled={picked.size === 0 || busyId !== null} onclick={restoreSelected}>
      Restore {picked.size === 0 ? '' : picked.size} selected
    </button>
    <button
      class="rounded-md border border-bad/50 px-2 py-1 text-xs text-bad hover:bg-bad/10 disabled:opacity-50"
      onclick={() => onDelete(session)}>Delete</button
    >
    <button
      class="shrink-0 rounded-md bg-accent px-2.5 py-1 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-50"
      disabled={busyId !== null}
      onclick={() => onRestore(session)}>
      {busyId === session.id ? 'Restoring…' : 'Restore'}</button
    >
  </div>
  <div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto rounded-lg border border-line bg-raised/60">
    <div class="relative w-full" style="height:{total}px">
      {#each rows as row (row.key)}
        {@const item = rowsData[row.index]}
        {#if item}
          <div class="absolute left-0 w-full px-1.5" style="transform:translateY({row.start}px)">
            {#if item.kind === 'window'}
              <p class="py-1 pl-1.5 text-[10px] font-semibold uppercase tracking-wide text-faint">{item.label}</p>
            {:else}
              <div class="flex h-6 items-center gap-2 rounded px-1.5 text-xs hover:bg-overlay">
                {#if item.windowIndex !== undefined && item.tabIndex !== undefined}
                  <input
                    type="checkbox"
                    class="h-3 w-3 shrink-0 accent-[var(--accent)]"
                    checked={picked.has(`${item.windowIndex}:${item.tabIndex}`)}
                    onchange={() => togglePick(item.windowIndex as number, item.tabIndex as number)}
                    title="Pick this tab for selective restore"
                  />
                {/if}
                {#if item.groupColor}
                  <span class="h-2 w-2 shrink-0 rounded-full {groupDot(item.groupColor)}"></span>
                {/if}
                <span class="min-w-0 flex-1 truncate text-dim" title={item.url}>{item.label}</span>
                {#if item.tab?.isDiscarded}<span class="ml-auto shrink-0 text-[10px] text-faint" title="Was asleep when snapshotted">💤</span>{/if}
              </div>
            {/if}
          </div>
        {/if}
      {/each}
    </div>
  </div>
</div>
