<script lang="ts">
  import LiveTabs from '@/lib/ui/LiveTabs.svelte';
  import SessionDetail from '@/lib/ui/SessionDetail.svelte';
  import SessionList from '@/lib/ui/SessionList.svelte';
  import { pageSessions } from '@/core/db';
  import { sendToBackground } from '@/core/messaging';
  import { parseMarvellousSuspenderUrl } from '@/core/sanitize';
  import type { UnifiedSession } from '@/types';

  let sessions: UnifiedSession[] = $state([]);
  let nextCursor: number | null = $state(null);
  let hasMore: boolean = $state(true);
  let loading: boolean = $state(false);
  let selected: UnifiedSession | null = $state(null);
  let busyId: string | null = $state(null);
  let notice: string = $state('');
  let tmsCount: number = $state(0);
  let migrating: boolean = $state(false);

  /** Marvellous Suspender detection across ALL windows (not just the focused one). */
  async function scanTms(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    tmsCount = tabs.filter((t) => t.url !== undefined && parseMarvellousSuspenderUrl(t.url) !== null).length;
  }

  $effect(() => {
    void scanTms();
    const onChange = () => void scanTms();
    chrome.tabs.onUpdated.addListener(onChange);
    chrome.tabs.onRemoved.addListener(onChange);
    chrome.tabs.onCreated.addListener(onChange);
    return () => {
      chrome.tabs.onUpdated.removeListener(onChange);
      chrome.tabs.onRemoved.removeListener(onChange);
      chrome.tabs.onCreated.removeListener(onChange);
    };
  });

  async function migrateTms(): Promise<void> {
    migrating = true;
    try {
      const res = await sendToBackground({ type: 'migrateTms' });
      notice = res.ok
        ? `Migrated ${String((res.payload as { migrated?: number })?.migrated ?? 0)} Marvellous Suspender tab(s).`
        : `Migration failed: ${res.error}`;
      await scanTms();
    } finally {
      migrating = false;
    }
  }

  async function loadMore(): Promise<void> {
    if (loading || !hasMore) return;
    loading = true;
    try {
      const page = await pageSessions({ limit: 20, cursor: nextCursor ?? undefined });
      sessions = [...sessions, ...page.items];
      nextCursor = page.nextCursor;
      hasMore = page.hasMore;
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    } finally {
      loading = false;
    }
  }

  async function refresh(): Promise<void> {
    sessions = [];
    nextCursor = null;
    hasMore = true;
    selected = null;
    await loadMore();
  }

  // Initial page load (and reloads after data-changing actions).
  $effect(() => {
    void loadMore();
  });

  async function snapshotNow(): Promise<void> {
    const res = await sendToBackground({ type: 'snapshotNow' });
    notice = res.ok ? 'Snapshot saved.' : `Snapshot failed: ${res.error}`;
    await refresh();
  }

  async function suspendInactive(): Promise<void> {
    const res = await sendToBackground({ type: 'runSweep' });
    notice = res.ok ? `Suspended ${String((res.payload as { discarded?: number })?.discarded ?? 0)} tab(s).` : `Sweep failed: ${res.error}`;
  }

  async function restore(session: UnifiedSession): Promise<void> {
    busyId = session.id;
    notice = '';
    try {
      const res = await sendToBackground({
        type: 'restoreSession',
        sessionId: session.id,
        screen: { availWidth: window.screen.availWidth, availHeight: window.screen.availHeight },
      });
      notice = res.ok ? 'Session restored.' : `Restore failed: ${res.error}`;
    } finally {
      busyId = null;
    }
  }

  function formatWhen(ts: number): string {
    return new Date(ts).toLocaleString();
  }
</script>

<div class="flex h-full flex-col gap-2 p-3 text-sm">
  <header class="flex items-center justify-between">
    <h1 class="text-base font-semibold tracking-tight text-neutral-100">TabDorm</h1>
    <div class="flex gap-2">
      <button
        class="rounded-md bg-neutral-800 px-2 py-1 text-xs font-medium hover:bg-neutral-700"
        onclick={() => void snapshotNow()}>Snapshot now</button
      >
      <button
        class="rounded-md bg-indigo-600 px-2 py-1 text-xs font-medium text-white hover:bg-indigo-500"
        onclick={() => void suspendInactive()}>Suspend inactive</button
      >
    </div>
  </header>

  {#if notice !== ''}
    <p class="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300" role="status">{notice}</p>
  {/if}

  {#if tmsCount > 0}
    <div class="flex items-center gap-2 rounded-md border border-amber-700/60 bg-amber-950/40 px-2 py-1.5">
      <p class="min-w-0 flex-1 text-xs text-amber-200">
        <span class="font-semibold">{tmsCount}</span> Marvellous Suspender tab{tmsCount === 1 ? '' : 's'} detected.
        Migrating restores each one to its real URL natively.
      </p>
      <button
        class="shrink-0 rounded-md bg-amber-600 px-2 py-1 text-xs font-semibold text-white hover:bg-amber-500 disabled:opacity-50"
        disabled={migrating}
        onclick={() => void migrateTms()}>
        {migrating ? 'Migrating…' : `Migrate ${tmsCount}`}
      </button>
    </div>
  {/if}

  <section class="flex min-h-0 flex-[2] flex-col">
    <h2 class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">Current window</h2>
    <LiveTabs />
  </section>

  <section class="flex min-h-0 flex-[3] flex-col">
    <h2 class="mb-1 text-xs font-semibold uppercase tracking-wide text-neutral-400">
      Sessions {#if loading}<span class="animate-pulse">· loading…</span>{/if}
    </h2>
    {#if selected !== null}
      <SessionDetail session={selected} {busyId} onRestore={(s) => void restore(s)} onBack={() => (selected = null)} />
    {:else}
      <SessionList {sessions} onRestore={(s) => void restore(s)} {busyId} onSelect={(s) => (selected = s)} {hasMore}
        {loading} onLoadMore={() => void loadMore()} />
    {/if}
  </section>
</div>
