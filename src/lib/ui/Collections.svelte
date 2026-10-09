<script lang="ts">
  import { sendToBackground } from '@/core/messaging';
  import { deleteCollection, findDuplicateUrls, pageCollections, putCollection } from '@/core/db/collections';
  import { VALID_GROUP_COLORS, type GroupColor, type TabCollection } from '@/types';

  const DOT: Record<GroupColor, string> = {
    grey: 'bg-neutral-400', blue: 'bg-blue-500', red: 'bg-red-500', yellow: 'bg-yellow-500',
    green: 'bg-green-500', pink: 'bg-pink-500', purple: 'bg-purple-500', cyan: 'bg-cyan-500',
    orange: 'bg-orange-500',
  };

  let items: TabCollection[] = $state([]);
  let nextCursor: number | null = $state(null);
  let hasMore: boolean = $state(true);
  let loading: boolean = $state(false);
  let notice: string = $state('');
  let busy: boolean = $state(false);

  async function loadMore(): Promise<void> {
    if (loading || !hasMore) return;
    loading = true;
    try {
      const page = await pageCollections({ limit: 20, cursor: nextCursor ?? undefined });
      items = [...items, ...page.items];
      nextCursor = page.nextCursor;
      hasMore = page.hasMore;
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  $effect(() => {
    void loadMore();
  });

  async function refresh(): Promise<void> {
    items = [];
    nextCursor = null;
    hasMore = true;
    await loadMore();
  }

  async function currentWindowTabs(): Promise<{ url: string; title: string; favIconUrl?: string }[]> {
    const win = await chrome.windows.getLastFocused();
    if (win.id === undefined) return [];
    const tabs = await chrome.tabs.query({ windowId: win.id });
    return tabs
      .filter((t) => t.url !== undefined && t.url !== '')
      .map((t) => ({ url: t.url as string, title: t.title ?? '', favIconUrl: t.favIconUrl }));
  }

  async function saveCurrentTabs(): Promise<void> {
    const name = window.prompt('Collection name', 'My collection');
    if (name === null || name.trim() === '') return;
    busy = true;
    try {
      const tabs = await currentWindowTabs();
      if (tabs.length === 0) { notice = 'No tabs to save.'; return; }
      await putCollection({ id: crypto.randomUUID(), name: name.trim(), pinned: false, tabs });
      notice = `Saved ${tabs.length} tab(s) to “${name.trim()}”.`;
      await refresh();
    } finally {
      busy = false;
    }
  }

  async function addCurrentTab(collection: TabCollection): Promise<void> {
    const win = await chrome.windows.getLastFocused();
    if (win.id === undefined) return;
    const [tab] = await chrome.tabs.query({ windowId: win.id, active: true });
    if (tab?.url === undefined || tab.url === '') return;
    const entry = { url: tab.url, title: tab.title ?? '' };
    const dupes = findDuplicateUrls(collection, [entry]);
    if (dupes.size > 0 && !window.confirm(`“${HOSTNAME(entry.url)}” is already in this collection. Add anyway?`)) return;
    await putCollection({ ...collection, tabs: [...collection.tabs, entry] });
    await refresh();
  }

  async function open(collection: TabCollection): Promise<void> {
    busy = true;
    try {
      const res = await sendToBackground({ type: 'openUrlList', urls: collection.tabs.map((t) => t.url) });
      notice = res.ok ? `Opening ${collection.tabs.length} tab(s)…` : `Open failed: ${res.error}`;
    } finally {
      busy = false;
    }
  }

  async function togglePin(collection: TabCollection): Promise<void> {
    await putCollection({ ...collection, pinned: !collection.pinned });
    await refresh();
  }

  async function setColor(collection: TabCollection, color: GroupColor): Promise<void> {
    await putCollection({ ...collection, color });
    await refresh();
  }

  async function rename(collection: TabCollection): Promise<void> {
    const name = window.prompt('Rename collection', collection.name);
    if (name === null || name.trim() === '' || name.trim() === collection.name) return;
    await putCollection({ ...collection, name: name.trim() });
    await refresh();
  }

  async function removeTab(collection: TabCollection, index: number): Promise<void> {
    await putCollection({ ...collection, tabs: collection.tabs.filter((_, i) => i !== index) });
    await refresh();
  }

  async function remove(collection: TabCollection): Promise<void> {
    if (!window.confirm(`Delete collection “${collection.name}”?`)) return;
    await deleteCollection(collection.id);
    notice = 'Collection deleted.';
    await refresh();
  }

  const HOSTNAME = (url: string): string => {
    try {
      return new URL(url).hostname;
    } catch {
      return url;
    }
  };
</script>

<div class="flex min-h-0 flex-col">
  <div class="mb-1 flex items-center gap-2">
    <button
      class="rounded-md border border-line px-2 py-1 text-[11px] text-dim hover:border-faint hover:text-ink disabled:opacity-50"
      disabled={busy}
      onclick={() => void saveCurrentTabs()}>＋ Save current tabs</button
    >
    {#if hasMore && items.length > 0}
      <button class="text-[11px] text-dim hover:text-ink" onclick={() => void loadMore()}>Load more…</button>
    {/if}
  </div>
  {#if notice !== ''}
    <p class="mb-1 rounded-md bg-overlay px-2 py-1 text-xs text-dim" role="status">{notice}</p>
  {/if}
  {#if items.length === 0}
    <p class="py-2 text-center text-xs text-faint">No collections yet. Save the current window’s tabs to start one.</p>
  {:else}
    <div class="flex flex-col gap-1.5 overflow-y-auto">
      {#each items as c (c.id)}
        <details class="rounded-lg border border-line bg-overlay px-2.5 py-1.5">
          <summary class="flex cursor-pointer list-none items-center gap-2 text-xs">
            {#if c.color !== undefined}<span class="h-2 w-2 shrink-0 rounded-full {DOT[c.color]}"></span>{/if}
            <span class="min-w-0 flex-1 truncate font-medium text-ink" title={c.name}>{c.pinned ? '📌 ' : ''}{c.name}</span>
            <span class="shrink-0 text-[10px] text-faint">{c.tabs.length} tabs</span>
          </summary>
          <div class="mt-1.5 flex flex-wrap items-center gap-1 border-t border-line/60 pt-1.5 text-[11px]">
            <button class="rounded border border-line px-1.5 py-0.5 text-dim hover:border-faint hover:text-ink" onclick={() => void open(c)}>Open all</button>
            <button class="rounded border border-line px-1.5 py-0.5 text-dim hover:border-faint hover:text-ink" onclick={() => void addCurrentTab(c)}>＋ tab</button>
            <button class="rounded border border-line px-1.5 py-0.5 text-dim hover:border-faint hover:text-ink" onclick={() => void togglePin(c)}>{c.pinned ? 'Unpin' : 'Pin'}</button>
            <button class="rounded border border-line px-1.5 py-0.5 text-dim hover:border-faint hover:text-ink" onclick={() => void rename(c)}>Rename</button>
            {#each VALID_GROUP_COLORS as color (color)}
              <button
                class="h-3.5 w-3.5 rounded-full {DOT[color]} {c.color === color ? 'ring-2 ring-ink/50' : 'opacity-50 hover:opacity-100'}"
                title="Color {color}"
                onclick={() => void setColor(c, color)}></button>
            {/each}
            <button class="ml-auto rounded px-1.5 py-0.5 text-bad hover:bg-bad/10" onclick={() => void remove(c)}>Delete</button>
          </div>
          <ul class="mt-1 flex flex-col gap-0.5">
            {#each c.tabs as t, i (i + t.url)}
              <li class="flex items-center gap-1.5 text-[11px] text-dim">
                <span class="min-w-0 flex-1 truncate" title={t.url}>{t.title === '' ? t.url : t.title}</span>
                <button class="shrink-0 text-faint hover:text-bad" title="Remove from collection" onclick={() => void removeTab(c, i)}>✕</button>
              </li>
            {/each}
          </ul>
        </details>
      {/each}
    </div>
  {/if}
</div>