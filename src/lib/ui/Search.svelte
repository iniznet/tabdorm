<script lang="ts">
  import { db } from '@/core/db';
  import { getSession } from '@/core/db';
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
  }

  async function openSessionHit(hit: SessionHit): Promise<void> {
    const session = await getSession(hit.id);
    if (session !== undefined) onOpenSession(session);
  }
</script>

<div class="flex flex-col">
  <input
    class="w-full rounded-md border border-line bg-overlay px-2.5 py-1 text-xs text-ink placeholder:text-faint"
    placeholder="Search tabs, sessions, collections… (in:sessions kw)"
    bind:value={query}
    oninput={schedule}
  />
  {#if query.trim() !== ''}
    <div class="mt-1 flex flex-col gap-1 rounded-lg border border-line bg-overlay p-1.5 text-xs">
      {#if searching}<p class="px-1 text-[10px] text-faint">Searching…</p>{/if}
      {#if openHits.length > 0}
        <p class="px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Open tabs</p>
        {#each openHits as hit (hit.tabId)}
          <button class="flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-dim hover:bg-raised hover:text-ink" onclick={() => void focusTab(hit)}>
            {#if hit.discarded}<span class="text-[10px]">💤</span>{/if}
            <span class="min-w-0 flex-1 truncate">{hit.title}</span>
          </button>
        {/each}
      {/if}
      {#if sessionHits.length > 0}
        <p class="px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Sessions</p>
        {#each sessionHits as hit (hit.id)}
          <button class="flex items-center gap-1.5 rounded px-1 py-0.5 text-left text-dim hover:bg-raised hover:text-ink" onclick={() => void openSessionHit(hit)}>
            <span class="min-w-0 flex-1 truncate">{hit.name}</span>
            <span class="shrink-0 text-[10px] text-faint">{hit.type.replace('_', ' ')}</span>
          </button>
        {/each}
      {/if}
      {#if collectionHits.length > 0}
        <p class="px-1 text-[10px] font-semibold uppercase tracking-wide text-faint">Collections</p>
        {#each collectionHits as hit (hit.id)}
          <p class="flex items-center gap-1.5 rounded px-1 py-0.5 text-dim">
            <span class="min-w-0 flex-1 truncate">{hit.name}</span>
            <span class="shrink-0 text-[10px] text-faint">{hit.count} tabs</span>
          </p>
        {/each}
      {/if}
      {#if !searching && openHits.length === 0 && sessionHits.length === 0 && collectionHits.length === 0}
        <p class="px-1 py-1 text-center text-[11px] text-faint">No matches.</p>
      {/if}
    </div>
  {/if}
</div>