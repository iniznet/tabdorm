<script lang="ts">
  import LiveTabs from '@/lib/ui/LiveTabs.svelte';
  import SessionDetail from '@/lib/ui/SessionDetail.svelte';
  import SessionList from '@/lib/ui/SessionList.svelte';
  import { pageSessions, deleteSession as deleteSessionById, renameSession } from '@/core/db';
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
  let tabCount: number = $state(0);
  let asleepCount: number = $state(0);

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
    await refresh();
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

  async function removeSession(session: UnifiedSession): Promise<void> {
    if (!window.confirm(`Delete “${session.name}”? This cannot be undone.`)) return;
    await deleteSessionById(session.id);
    notice = 'Session deleted.';
    await refresh();
  }

  async function rename(session: UnifiedSession, name: string): Promise<void> {
    try {
      await renameSession(session.id, name);
      sessions = sessions.map((s) => (s.id === session.id ? { ...s, name } : s));
      if (selected?.id === session.id) selected = { ...selected, name };
      notice = 'Session renamed.';
    } catch (error) {
      notice = error instanceof Error ? error.message : String(error);
    }
  }

  function openSettings(): void {
    void chrome.runtime.openOptionsPage();
  }
</script>

<div class="flex h-full flex-col gap-2 p-2.5 text-sm">
  <header class="flex items-center gap-2">
    <h1 class="text-base font-semibold tracking-tight text-ink">TabDorm</h1>
    <span
      class="rounded-full border px-2 py-0.5 text-[10px] {asleepCount > 0
        ? 'border-good/40 text-good'
        : 'border-line text-faint'}"
      title="Tabs natively discarded in this window">{asleepCount}/{tabCount} asleep</span
    >
    <button
      class="ml-auto grid h-7 w-7 place-items-center rounded-md border border-line text-dim hover:border-faint hover:text-ink"
      aria-label="Open settings"
      title="Settings"
      onclick={openSettings}>⚙</button
    >
  </header>

  <div class="grid grid-cols-2 gap-2">
    <button
      class="rounded-md bg-accent px-2 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-50"
      onclick={() => void snapshotNow()}>Snapshot now</button
    >
    <button
      class="rounded-md border border-line px-2 py-1.5 text-xs font-medium text-dim hover:border-faint hover:text-ink"
      onclick={() => void suspendInactive()}>Suspend inactive</button
    >
  </div>

  {#if notice !== ''}
    <p class="rounded-md bg-overlay px-2 py-1 text-xs text-dim" role="status">{notice}</p>
  {/if}

  {#if tmsCount > 0}
    <div class="flex items-center gap-2 rounded-md border border-warn/40 bg-warn/10 px-2 py-1.5">
      <p class="min-w-0 flex-1 text-xs leading-snug text-warn">
        <span class="font-semibold">{tmsCount}</span> Marvellous Suspender tab{tmsCount === 1 ? '' : 's'} detected.
        Migrating restores each one to its real URL natively.
      </p>
      <button
        class="shrink-0 rounded-md bg-warn px-2 py-1 text-xs font-semibold text-black hover:brightness-110 disabled:opacity-50"
        disabled={migrating}
        onclick={() => void migrateTms()}>
        {migrating ? 'Migrating…' : `Migrate ${tmsCount}`}
      </button>
    </div>
  {/if}

  <section class="flex min-h-0 flex-[2] flex-col">
    <h2 class="mb-1 pl-0.5 text-[10px] font-semibold uppercase tracking-wider text-faint">Current window</h2>
    <LiveTabs onStats={(total, asleep) => { tabCount = total; asleepCount = asleep; }} />
  </section>

  <section class="flex min-h-0 flex-[3] flex-col">
    <h2 class="mb-1 pl-0.5 text-[10px] font-semibold uppercase tracking-wider text-faint">
      Sessions {#if loading}<span class="animate-pulse">· loading…</span>{/if}
    </h2>
    {#if selected !== null}
      <SessionDetail session={selected} {busyId} onRestore={(s) => void restore(s)} onBack={() => (selected = null)} onRename={(s, name) => void rename(s, name)} onDelete={(s) => void removeSession(s)} />
    {:else}
      <SessionList {sessions} onRestore={(s) => void restore(s)} {busyId} onSelect={(s) => (selected = s)} onDelete={(s) => void removeSession(s)} {hasMore} {loading} onLoadMore={() => void loadMore()} onImported={() => void refresh()} />
    {/if}
  </section>
</div>
