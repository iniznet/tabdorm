<script lang="ts">
  import { createVirtualizer } from '@tanstack/svelte-virtual';
  import { get } from 'svelte/store';
  import { putSession } from '@/core/db';
  import { parseImportedSession } from '@/core/session-import';
  import { extractUrls } from '@/core/url-extract';
  import type { RestoreDestination, RestoreSelectionEntry } from '@/types/messages';
  import Icon from '@/lib/ui/Icon.svelte';
  import type { UnifiedSession } from '@/types';

  interface Props {
    sessions: UnifiedSession[];
    busyId: string | null;
    hasMore: boolean;
    loading: boolean;
    onSelect: (session: UnifiedSession) => void;
    onRestore: (session: UnifiedSession, options?: { destination?: RestoreDestination; selection?: RestoreSelectionEntry[] }) => void;
    onDelete: (session: UnifiedSession) => void;
    onLoadMore: () => void;
    onImported: () => void;
    onOpenUrls: (urls: string[]) => void;
    onSaveUrls: (urls: string[]) => void;
  }

  let { sessions, busyId, hasMore, loading, onSelect, onRestore, onDelete, onLoadMore, onImported, onOpenUrls, onSaveUrls }: Props = $props();

  let pasteOpen = $state(false);
  let pasteText = $state('');
  let pasteError = $state('');
  const pastedUrls = $derived(extractUrls(pasteText));

  let scrollEl: HTMLDivElement | undefined = $state();
  let query = $state('');
  let menuFor: string | null = $state(null);

  const visible = $derived(
    query.trim() === ''
      ? sessions
      : sessions.filter((s) => s.name.toLowerCase().includes(query.trim().toLowerCase())),
  );

  type Item =
    | { kind: 'header'; key: string; label: string; count: number }
    | { kind: 'row'; key: string; session: UnifiedSession };

  const GROUP_ORDER: UnifiedSession['type'][] = ['user_saved', 'closed_window', 'auto_snapshot'];
  const GROUP_LABEL: Record<UnifiedSession['type'], string> = {
    user_saved: 'Saved by you',
    closed_window: 'Closed windows',
    auto_snapshot: 'Auto snapshots',
  };

  /**
   * Snapshot kinds stay apart under their own heading — a hand-saved snapshot is
   * not an hourly auto capture — and filtering only narrows rows inside a heading.
   */
  const items = $derived.by<Item[]>(() => {
    const out: Item[] = [];
    for (const type of GROUP_ORDER) {
      const list = visible.filter((session) => session.type === type);
      if (list.length === 0) continue;
      out.push({ kind: 'header', key: 'h-' + type, label: GROUP_LABEL[type], count: list.length });
      for (const session of list) out.push({ kind: 'row', key: 'r-' + session.id, session });
    }
    return out;
  });

  const virtualizer = createVirtualizer({
    get count() {
      return items.length;
    },
    getScrollElement: () => scrollEl ?? null,
    estimateSize: (index) => (items[index]?.kind === 'header' ? 26 : 56),
    getItemKey: (index) => items[index]?.key ?? index,
    overscan: 8,
  });

  // Keep the virtualizer's item count in lockstep with filtered, paginated data.
  $effect(() => {
    const count = items.length;
    get(virtualizer).setOptions({ count });
  });

  const virtualItems = $derived($virtualizer.getVirtualItems());
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

<div class="flex min-h-0 flex-1 flex-col overflow-hidden">
  <div class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
    <p class="num min-w-0 flex-1 text-[12px] text-dim">
      <span class="font-semibold text-ink">{sessions.length}</span>
      <span class="text-faint">saved</span>
    </p>
    <div class="flex h-7 w-[42%] min-w-24 items-center gap-1 rounded-md border border-line bg-overlay px-1.5 focus-within:border-line-strong">
      <Icon name="search" size={12} class="shrink-0 text-faint" />
      <input
        class="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-faint focus:outline-none"
        placeholder="Filter"
        aria-label="Filter sessions"
        bind:value={query}
      />
    </div>
    <button
      class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-dim hover:bg-overlay hover:text-ink"
      title="Import a session file"
      aria-label="Import a session file"
      onclick={() => importInput?.click()}><Icon name="upload" size={13} /></button
    >
    <button
      class="grid h-7 w-7 shrink-0 place-items-center rounded-md text-dim hover:bg-overlay hover:text-ink"
      title="Paste links"
      aria-label="Paste links"
      aria-expanded={pasteOpen}
      onclick={() => (pasteOpen = !pasteOpen)}><Icon name="plus" size={13} /></button
    >
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
  </div>
  {#if importError !== null}
    <div class="flex items-start gap-1.5 border-b border-line px-3 py-1.5 text-[11px] text-bad" role="alert">
      <Icon name="alert" size={12} class="mt-0.5 shrink-0" />
      <p class="min-w-0 flex-1 break-words">{importError}</p>
    </div>
  {/if}
  {#if pasteOpen}
    <div class="mb-1 rounded-lg border border-line bg-overlay p-2">
      <textarea
        class="h-20 w-full resize-y rounded-md border border-line bg-raised px-2 py-1 text-[12px] text-ink placeholder:text-faint"
        placeholder="Paste anything containing links — an email, markdown, a list of URLs…"
        bind:value={pasteText}></textarea>
      <div class="mt-1 flex items-center gap-2">
        <span class="text-[11px] text-faint">
          {pasteText.trim() === '' ? 'Waiting for text…' : `${pastedUrls.length} unique URL${pastedUrls.length === 1 ? '' : 's'} found`}
        </span>
        <button
          class="ml-auto rounded-md border border-line px-2 py-1 text-[11px] text-dim hover:border-faint hover:text-ink disabled:opacity-50"
          disabled={pastedUrls.length === 0}
          onclick={() => { onOpenUrls(pastedUrls); pasteOpen = false; pasteText = ''; }}>Open as tabs</button
        >
        <button
          class="rounded-md bg-awake px-2 py-1 text-[11px] font-medium text-on-awake hover:bg-accent-strong disabled:opacity-50"
          disabled={pastedUrls.length === 0}
          onclick={() => { onSaveUrls(pastedUrls); pasteOpen = false; pasteText = ''; }}>Save as session</button
        >
        {#if pasteError !== ''}
          <span class="text-[11px] text-bad">{pasteError}</span>
        {/if}
      </div>
    </div>
  {/if}
  <div bind:this={scrollEl} class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    <div class="relative w-full" style="height:{total}px">
      {#each virtualItems as row (row.key)}
        {@const item = items[row.index]}
        {#if item?.kind === 'header'}
          <div class="absolute left-0 w-full" style="transform:translateY({row.start}px)">
            <div class="flex h-[26px] items-center gap-1.5 border-b border-line/60 bg-raised px-3">
              <span class="min-w-0 flex-1 truncate text-[11px] font-medium text-dim">{item.label}</span>
              <span class="num shrink-0 text-[10px] text-faint">{item.count}</span>
            </div>
          </div>
        {:else if item?.kind === 'row'}
          {@const session = item.session}
          <!--
            The wrapper is itself a stacking context (absolute + transform), so the row's
            z-index must live here: inside it, a child cannot climb above later siblings.
          -->
          <div
            class="absolute left-0 w-full"
            style="transform:translateY({row.start}px); z-index:{menuFor === session.id ? 30 : 0}"
          >
            <div class="relative flex h-14 items-center gap-2 border-b border-line/70 px-3 hover:bg-raised">
              <button class="min-w-0 flex-1 text-left" onclick={() => onSelect(session)}>
                <p class="truncate text-[13px] text-ink">{session.name}</p>
                <p class="num mt-0.5 flex items-center gap-1.5 text-[11px] text-dim">
                  <span class="rounded px-1 text-[10px] font-medium {BADGE[session.type]}">{typeBadge(session.type)}</span>
                  <span class="truncate">{formatWhenLong(session.timestamp)} · {session.windows.reduce((n, w) => n + w.tabs.length, 0)} tabs</span>
                </p>
              </button>
              <button
                class="shrink-0 rounded-md bg-awake px-2.5 py-1 text-[12px] font-semibold text-on-awake hover:bg-accent-strong disabled:opacity-40"
                disabled={busyId !== null}
                onclick={() => onRestore(session)}>
                {busyId === session.id ? 'Restoring…' : 'Restore'}
              </button>
              <button
                class="grid h-6 w-6 shrink-0 place-items-center rounded text-faint hover:bg-overlay hover:text-ink"
                aria-label="Session actions"
                aria-expanded={menuFor === session.id}
                onclick={(e) => {
                  e.stopPropagation();
                  menuFor = menuFor === session.id ? null : session.id;
                }}><Icon name="dots" size={13} /></button
              >
              {#if menuFor === session.id}
                <div
                  class="absolute right-2 top-[46px] z-40 w-44 rounded-[10px] border border-line-strong bg-raised py-1 shadow-[0_10px_28px_rgb(0_0_0_/_0.55)]">
                  <button
                    class="block w-full px-3 py-1.5 text-left text-[12px] text-dim hover:bg-overlay hover:text-ink"
                    onclick={(e) => {
                      e.stopPropagation();
                      menuFor = null;
                      onSelect(session);
                    }}>Details & rename</button
                  >
                  <button
                    class="block w-full px-3 py-1.5 text-left text-[12px] text-dim hover:bg-overlay hover:text-ink"
                    onclick={(e) => {
                      e.stopPropagation();
                      menuFor = null;
                      exportSession(session);
                    }}>Export JSON</button
                  >
                  <button
                    class="block w-full px-3 py-1.5 text-left text-[12px] text-bad hover:bg-overlay"
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
      <div class="flex justify-center border-b border-line px-3 py-2">
        <button
          class="rounded-md px-2 py-1 text-[12px] text-dim hover:bg-overlay hover:text-ink disabled:opacity-40"
          disabled={loading}
          onclick={onLoadMore}>{loading ? 'Loading…' : 'Load more'}</button
        >
      </div>
    {:else if visible.length === 0}
      <div class="px-4 py-6 text-center">
        {#if sessions.length === 0}
          <p class="text-[13px] text-ink">No snapshots yet.</p>
          <p class="mt-1 text-[12px] text-dim">
            Snapshot now captures every open tab so a bulk close is always reversible.
          </p>
        {:else}
          <p class="text-[13px] text-ink">No session matches “{query.trim()}”.</p>
          <button class="mt-2 text-[12px] text-awake underline underline-offset-2" onclick={() => (query = '')}>
            Clear filter
          </button>
        {/if}
      </div>
    {/if}
  </div>
</div>
