<script lang="ts">
  import { db } from '@/core/db';
  import { getSession } from '@/core/db';
  import Icon from '@/lib/ui/Icon.svelte';
  import type { StoredTab, UnifiedSession } from '@/types';

  interface Props {
    onOpenSession: (session: UnifiedSession) => void;
  }

  let { onOpenSession }: Props = $props();

  interface OpenHit { tabId: number; title: string; url: string; active: boolean; discarded: boolean }
  interface SessionHit { id: string; name: string; timestamp: number; type: string }
  interface CollectionHit { id: string; name: string; count: number }

  let query = $state('');
  let openHits: OpenHit[] = $state([]);
  let sessionHits: SessionHit[] = $state([]);
  let collectionHits: CollectionHit[] = $state([]);
  let searching = $state(false);
  let focused = $state(false);

  /** Scope prefixes: "in:open", "in:sessions", "in:collections". */
  function parseScope(q: string): { scope: string | null; text: string } {
    const m = q.trim().match(/^(in:(open|sessions|collections))\s+(.+)$/i);
    if (m === null || m[2] === undefined || m[3] === undefined) {
      return { scope: null, text: q.trim().toLowerCase() };
    }
    return { scope: m[2].toLowerCase(), text: m[3].toLowerCase() };
  }

  let timer: ReturnType<typeof setTimeout> | undefined;

  function schedule(): void {
    clearTimeout(timer);
    timer = setTimeout(() => void run(), 250);
  }

  async function run(): Promise<void> {
    const { scope, text } = parseScope(query);
    if (text === '') {
      openHits = [];
      sessionHits = [];
      collectionHits = [];
      return;
    }
    searching = true;
    try {
      const wantOpen = scope === null || scope === 'open';
      const wantSessions = scope === null || scope === 'sessions';
      const wantCollections = scope === null || scope === 'collections';
      const jobs: Promise<void>[] = [];
      if (wantOpen) {
        jobs.push(
          chrome.tabs.query({}).then((tabs) => {
            openHits = tabs
              .filter((t) => t.id !== undefined && (t.title + ' ' + (t.url ?? '')).toLowerCase().includes(text))
              .slice(0, 20)
              .map((t) => ({ tabId: t.id as number, title: t.title ?? '', url: t.url ?? '', active: t.active === true, discarded: t.discarded === true }));
          }),
        );
      }
      if (wantSessions) {
        jobs.push(
          db.sessions
            .filter((s) => (s.name + ' ' + s.windows.map((w: { tabs: StoredTab[] }) => w.tabs.map((t) => t.title + ' ' + t.url).join(' ')).join(' ')).toLowerCase().includes(text))
            .limit(30)
            .toArray()
            .then((rows) => {
              sessionHits = rows.map((r) => ({ id: r.id, name: r.name, timestamp: r.timestamp, type: r.type }));
            }),
        );
      }
      if (wantCollections) {
        jobs.push(
          db.collections
            .filter((c) => (c.name + ' ' + c.tabs.map((t) => t.title + ' ' + t.url).join(' ')).toLowerCase().includes(text))
            .limit(20)
            .toArray()
            .then((rows) => {
              collectionHits = rows.map((r) => ({ id: r.id, name: r.name, count: r.tabs.length }));
            }),
        );
      }
      await Promise.all(jobs);
    } finally {
      searching = false;
    }
  }

  async function focusTab(hit: OpenHit): Promise<void> {
    await chrome.tabs.update(hit.tabId, { active: true });
    const tab = await chrome.tabs.get(hit.tabId);
    if (tab.windowId !== undefined) await chrome.windows.update(tab.windowId, { focused: true });
    query = '';
  }

  async function openSessionHit(hit: SessionHit): Promise<void> {
    const session = await getSession(hit.id);
    if (session !== undefined) {
      onOpenSession(session);
      query = '';
    }
  }

  function clear(): void {
    query = '';
    openHits = [];
    sessionHits = [];
    collectionHits = [];
  }

  const hasHits = $derived(openHits.length + sessionHits.length + collectionHits.length > 0);
  const showPanel = $derived(query.trim() !== '');
</script>

<div class="relative">
  <div
    class="flex h-8 items-center gap-1.5 rounded-md border border-line bg-overlay px-2 transition-colors duration-120 focus-within:border-line-strong"
  >
    <Icon name="search" size={13} class="shrink-0 text-faint" />
    <input
      class="min-w-0 flex-1 bg-transparent text-[12px] text-ink placeholder:text-faint focus:outline-none"
      placeholder="Search tabs, sessions, collections"
      aria-label="Search everything"
      bind:value={query}
      oninput={schedule}
      onfocus={() => (focused = true)}
      onblur={() => (focused = false)}
      onkeydown={(event) => {
        if (event.key === 'Escape') clear();
      }}
    />
    {#if query !== ''}
      <button class="shrink-0 text-faint hover:text-ink" aria-label="Clear search" onclick={clear}>
        <Icon name="close" size={12} />
      </button>
    {/if}
  </div>

  {#if showPanel}
    <div
      class="absolute inset-x-0 top-[calc(100%+4px)] z-30 max-h-[55vh] overflow-y-auto rounded-[10px] border border-line bg-overlay p-1 shadow-[0_8px_24px_rgb(0_0_0_/_0.45)]"
    >
      {#if searching && !hasHits}
        <p class="px-2 py-1.5 text-[11px] text-faint">Searching…</p>
      {/if}

      {#if openHits.length > 0}
        <p class="px-2 pt-1 pb-0.5 text-[10px] font-semibold text-faint">Open tabs</p>
        {#each openHits as hit (hit.tabId)}
          <button
            class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-raised"
            onclick={() => void focusTab(hit)}
          >
            <Icon
              name={hit.discarded ? 'zzz' : 'external'}
              size={12}
              class="shrink-0 {hit.discarded ? 'text-asleep' : 'text-faint'}"
            />
            <span class="min-w-0 flex-1 truncate text-[12px] {hit.active ? 'font-semibold text-ink' : 'text-dim'}">{hit.title}</span>
          </button>
        {/each}
      {/if}

      {#if sessionHits.length > 0}
        <p class="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-faint">Sessions</p>
        {#each sessionHits as hit (hit.id)}
          <button
            class="flex w-full items-center gap-1.5 rounded px-2 py-1 text-left hover:bg-raised"
            onclick={() => void openSessionHit(hit)}
          >
            <Icon name="layers" size={12} class="shrink-0 text-faint" />
            <span class="min-w-0 flex-1 truncate text-[12px] text-dim">{hit.name}</span>
            <span class="shrink-0 text-[10px] text-faint">{hit.type.replace('_', ' ')}</span>
          </button>
        {/each}
      {/if}

      {#if collectionHits.length > 0}
        <p class="px-2 pt-1.5 pb-0.5 text-[10px] font-semibold text-faint">Collections</p>
        {#each collectionHits as hit (hit.id)}
          <div class="flex items-center gap-1.5 px-2 py-1">
            <Icon name="shield" size={12} class="shrink-0 text-faint" />
            <span class="min-w-0 flex-1 truncate text-[12px] text-dim">{hit.name}</span>
            <span class="num shrink-0 text-[10px] text-faint">{hit.count} tabs</span>
          </div>
        {/each}
      {/if}

      {#if !searching && !hasHits}
        <p class="px-2 py-2 text-center text-[11px] text-faint">
          No matches. Try <span class="text-dim">in:sessions</span> or <span class="text-dim">in:open</span>.
        </p>
      {/if}
    </div>
  {/if}
</div>
