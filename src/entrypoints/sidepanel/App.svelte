<script lang="ts">
  import LiveTabs from '@/lib/ui/LiveTabs.svelte';
  import SessionDetail from '@/lib/ui/SessionDetail.svelte';
  import SessionList from '@/lib/ui/SessionList.svelte';
  import Collections from '@/lib/ui/Collections.svelte';
  import Search from '@/lib/ui/Search.svelte';
  import Duplicates from '@/lib/ui/Duplicates.svelte';
  import StaleTabs from '@/lib/ui/StaleTabs.svelte';
  import Icon from '@/lib/ui/Icon.svelte';
  import { pageSessions, deleteSession as deleteSessionById, renameSession, putSession } from '@/core/db';
  import { contentHashOf } from '@/core/hash';
  import { sendToBackground } from '@/core/messaging';
  import { parseMarvellousSuspenderUrl } from '@/core/sanitize';
  import type { RestoreDestination, RestoreSelectionEntry } from '@/types/messages';
  import type { UnifiedSession } from '@/types';

  let sessions: UnifiedSession[] = $state([]);
  let nextCursor: number | null = $state(null);
  let hasMore: boolean = $state(true);
  let loading: boolean = $state(false);
  let selected: UnifiedSession | null = $state(null);
  let busyId: string | null = $state(null);
  let notice: string = $state('');
  let noticeKind: 'info' | 'bad' = $state('info');
  let tmsCount: number = $state(0);
  let migrating: boolean = $state(false);
  let tabCount: number = $state(0);
  let asleepCount: number = $state(0);
  let view: 'tabs' | 'stale' | 'dups' | 'sessions' | 'sets' = $state('tabs');

  const views = [
    { id: 'tabs', label: 'Tabs' },
    { id: 'stale', label: 'Stale' },
    { id: 'dups', label: 'Dups' },
    { id: 'sessions', label: 'Sessions' },
    { id: 'sets', label: 'Sets' },
  ] as const;

  /** Battery reporting: UI surfaces have DOM getBattery access the SW may lack. */
  $effect(() => {
    const nav = navigator as Navigator & { getBattery?: () => Promise<{ charging: boolean; addEventListener: (t: string, l: () => void) => void; removeEventListener: (t: string, l: () => void) => void }> };
    if (typeof nav.getBattery !== 'function') return;
    let battery: { charging: boolean; removeEventListener: (t: string, l: () => void) => void } | undefined;
    const report = () => {
      if (battery === undefined) return;
      void sendToBackground({ type: 'reportBattery', charging: battery.charging });
    };
    void nav.getBattery().then((b) => {
      battery = b;
      report();
      b.addEventListener('chargingchange', report);
    });
    return () => {
      battery?.removeEventListener('chargingchange', report);
    };
  });

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

  function say(message: string, kind: 'info' | 'bad' = 'info'): void {
    notice = message;
    noticeKind = kind;
  }

  async function migrateTms(): Promise<void> {
    migrating = true;
    try {
      const res = await sendToBackground({ type: 'migrateTms' });
      if (res.ok) say(`Migrated ${String((res.payload as { migrated?: number })?.migrated ?? 0)} Marvellous Suspender tab(s).`);
      else say(`Migration failed: ${res.error}`, 'bad');
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
      say(error instanceof Error ? error.message : String(error), 'bad');
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
    if (res.ok) say('Snapshot saved.');
    else say(`Snapshot failed: ${res.error}`, 'bad');
    await refresh();
  }

  async function suspendInactive(): Promise<void> {
    const res = await sendToBackground({ type: 'runSweep' });
    if (res.ok) say(`Suspended ${String((res.payload as { discarded?: number })?.discarded ?? 0)} tab(s).`);
    else say(`Sweep failed: ${res.error}`, 'bad');
    await refresh();
  }

  async function restore(
    session: UnifiedSession,
    options?: { destination?: RestoreDestination; selection?: RestoreSelectionEntry[] },
  ): Promise<void> {
    busyId = session.id;
    notice = '';
    try {
      const res = await sendToBackground({
        type: 'restoreSession',
        sessionId: session.id,
        screen: { availWidth: window.screen.availWidth, availHeight: window.screen.availHeight },
        destination: options?.destination,
        selection: options?.selection,
      });
      const created = res.ok ? String((res.payload as { tabsCreated?: number } | undefined)?.tabsCreated ?? 0) : '0';
      if (res.ok) say('Restored ' + created + ' tab(s).');
      else say('Restore failed: ' + res.error, 'bad');
    } finally {
      busyId = null;
    }
  }

  async function openPastedUrls(urls: string[]): Promise<void> {
    const res = await sendToBackground({ type: 'openUrlList', urls });
    const created = res.ok ? String((res.payload as { tabsCreated?: number } | undefined)?.tabsCreated ?? urls.length) : '0';
    if (res.ok) say('Opening ' + created + ' tab(s)…');
    else say('Open failed: ' + res.error, 'bad');
  }

  async function savePastedUrls(urls: string[]): Promise<void> {
    const windows = [{ state: 'normal' as const, groups: [], tabs: urls.map((url) => ({ url, title: '', pinned: false, isDiscarded: false })) }];
    await putSession({
      id: crypto.randomUUID(),
      name: 'Pasted links (' + urls.length + ')',
      timestamp: Date.now(),
      type: 'user_saved',
      contentHash: contentHashOf(windows),
      windows,
    });
    say('Saved ' + urls.length + ' link(s) as a session.');
    await refresh();
  }

  async function removeSession(session: UnifiedSession): Promise<void> {
    if (!window.confirm(`Delete “${session.name}”? This cannot be undone.`)) return;
    await deleteSessionById(session.id);
    say('Session deleted.');
    await refresh();
  }

  async function rename(session: UnifiedSession, name: string): Promise<void> {
    try {
      await renameSession(session.id, name);
      sessions = sessions.map((s) => (s.id === session.id ? { ...s, name } : s));
      if (selected?.id === session.id) selected = { ...selected, name };
      say('Session renamed.');
    } catch (error) {
      say(error instanceof Error ? error.message : String(error), 'bad');
    }
  }

  function openSettings(): void {
    void chrome.runtime.openOptionsPage();
  }
</script>

<div class="flex h-dvh min-h-0 flex-col overflow-hidden bg-surface text-ink">
  <header class="sticky top-0 z-20 shrink-0 border-b border-line bg-raised/95 backdrop-blur-sm">
    <div class="flex items-center gap-2 px-3 pt-2.5 pb-2">
      <h1 class="text-[15px] font-semibold text-ink">TabDorm</h1>
      <span
        class="num inline-flex items-center gap-1 rounded-full border px-1.5 py-px text-[11px] {asleepCount > 0
          ? 'border-asleep/35 text-asleep'
          : 'border-line text-faint'}"
        title="Tabs natively discarded in this window"
      >
        <Icon name="zzz" size={11} />
        {asleepCount}/{tabCount}
      </span>
      <div class="ml-auto flex items-center gap-0.5">
        <button
          class="grid h-7 w-7 place-items-center rounded-md text-dim transition-colors duration-120 hover:bg-overlay hover:text-ink"
          title="Snapshot now"
          aria-label="Snapshot now"
          onclick={() => void snapshotNow()}><Icon name="camera" /></button
        >
        <button
          class="grid h-7 w-7 place-items-center rounded-md text-dim transition-colors duration-120 hover:bg-overlay hover:text-ink"
          title="Suspend inactive tabs"
          aria-label="Suspend inactive tabs"
          onclick={() => void suspendInactive()}><Icon name="moon" /></button
        >
        <button
          class="grid h-7 w-7 place-items-center rounded-md text-dim transition-colors duration-120 hover:bg-overlay hover:text-ink"
          title="Settings"
          aria-label="Settings"
          onclick={openSettings}><Icon name="sliders" /></button
        >
      </div>
    </div>

    <div class="px-3 pb-2">
      <Search onOpenSession={(s) => {
        selected = s;
        view = 'sessions';
      }} />
    </div>

    <nav class="-mx-px flex items-stretch gap-0 overflow-x-auto px-3" aria-label="Views">
      {#each views as item (item.id)}
        <button
          class="relative shrink-0 px-2.5 pb-1.5 pt-1 text-[12px] font-medium transition-colors duration-120 {view === item.id
            ? 'text-ink'
            : 'text-dim hover:text-ink'}"
          aria-current={view === item.id ? 'page' : undefined}
          onclick={() => {
            view = item.id;
            if (item.id !== 'sessions') selected = null;
          }}
        >
          {item.label}
          {#if view === item.id}
            <span class="absolute inset-x-1.5 -bottom-px h-px bg-awake"></span>
          {/if}
        </button>
      {/each}
    </nav>
  </header>

  {#if notice !== ''}
    <div
      class="flex items-start gap-2 border-b border-line px-3 py-1.5 text-[12px] {noticeKind === 'bad'
        ? 'text-bad'
        : 'text-dim'}"
      role="status"
    >
      <Icon name={noticeKind === 'bad' ? 'alert' : 'check'} size={13} class="mt-0.5 shrink-0" />
      <p class="min-w-0 flex-1 break-words">{notice}</p>
      <button class="shrink-0 text-faint hover:text-ink" aria-label="Dismiss" onclick={() => (notice = '')}>
        <Icon name="close" size={13} />
      </button>
    </div>
  {/if}

  {#if tmsCount > 0}
    <div class="flex items-start gap-2 border-b border-warn/25 bg-warn/5 px-3 py-2">
      <Icon name="alert" size={13} class="mt-0.5 shrink-0 text-warn" />
      <p class="min-w-0 flex-1 text-[12px] leading-snug text-dim">
        <span class="num font-semibold text-warn">{tmsCount}</span> Marvellous Suspender tab{tmsCount === 1 ? '' : 's'} found.
        Migrating restores each one to its real URL natively.
      </p>
      <button
        class="shrink-0 rounded-md bg-warn px-2 py-1 text-[11px] font-semibold text-on-awake hover:brightness-105 disabled:opacity-50"
        disabled={migrating}
        onclick={() => void migrateTms()}>
        {migrating ? 'Migrating…' : `Migrate ${tmsCount}`}
      </button>
    </div>
  {/if}

  <main class="flex min-h-0 flex-1 flex-col overflow-hidden">
    {#if view === 'tabs'}
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <LiveTabs onStats={(total, asleep) => { tabCount = total; asleepCount = asleep; }} />
      </div>
    {:else if view === 'stale'}
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <StaleTabs />
      </div>
    {:else if view === 'dups'}
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Duplicates />
      </div>
    {:else if view === 'sets'}
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <Collections />
      </div>
    {:else if selected !== null}
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SessionDetail
          session={selected}
          {busyId}
          onRestore={(s) => void restore(s)}
          onBack={() => (selected = null)}
          onRename={(s, name) => void rename(s, name)}
          onDelete={(s) => void removeSession(s)}
        />
      </div>
    {:else}
      <div class="flex min-h-0 flex-1 flex-col overflow-hidden">
        <SessionList
          {sessions}
          onRestore={(s, options) => void restore(s, options)}
          {busyId}
          onSelect={(s) => (selected = s)}
          onDelete={(s) => void removeSession(s)}
          {hasMore}
          {loading}
          onLoadMore={() => void loadMore()}
          onImported={() => void refresh()}
          onOpenUrls={(urls) => void openPastedUrls(urls)}
          onSaveUrls={(urls) => void savePastedUrls(urls)}
        />
      </div>
    {/if}
  </main>
</div>
