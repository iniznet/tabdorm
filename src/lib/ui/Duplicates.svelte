<script lang="ts">
  import { findDuplicateGroups, type DuplicateGroup } from '@/core/duplicates';
  import { describeCloseOutcome, parseCloseOutcome } from '@/core/close-duplicates';
  import { sendToBackground } from '@/core/messaging';
  import Icon from '@/lib/ui/Icon.svelte';

  let groups: DuplicateGroup[] = $state([]);
  let ready: boolean = $state(false);
  let busy: boolean = $state(false);
  let notice: string = $state('');

  const extraCount = $derived(groups.reduce((sum, group) => sum + group.entries.length - 1, 0));

  async function scan(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    const rows = tabs
      .filter((t) => t.id !== undefined && t.url !== undefined && t.url !== '')
      .map((t) => ({
        tabId: t.id as number,
        title: t.title ?? '',
        url: t.url ?? '',
        pinned: t.pinned,
        active: t.active,
        discarded: t.discarded ?? false,
      }));
    groups = findDuplicateGroups(rows);
    ready = true;
  }

  $effect(() => {
    void scan();
    // onUpdated fires per load-progress event; coalesce into one scan per burst.
    let pending: ReturnType<typeof setTimeout> | undefined;
    const scheduleScan = (): void => {
      if (pending !== undefined) clearTimeout(pending);
      pending = setTimeout(() => void scan(), 300);
    };
    chrome.tabs.onCreated.addListener(scheduleScan);
    chrome.tabs.onRemoved.addListener(scheduleScan);
    chrome.tabs.onUpdated.addListener(scheduleScan);
    chrome.tabs.onActivated.addListener(scheduleScan);
    return () => {
      if (pending !== undefined) clearTimeout(pending);
      chrome.tabs.onCreated.removeListener(scheduleScan);
      chrome.tabs.onRemoved.removeListener(scheduleScan);
      chrome.tabs.onUpdated.removeListener(scheduleScan);
      chrome.tabs.onActivated.removeListener(scheduleScan);
    };
  });

  async function closeTargets(tabIds: number[]): Promise<void> {
    busy = true;
    notice = '';
    try {
      const res = await sendToBackground({ type: 'closeDuplicates', tabIds });
      notice = summarize(res);
    } finally {
      busy = false;
    }
    await scan();
  }

  async function closeAllExtras(): Promise<void> {
    const targets = groups.flatMap((group) => group.entries.filter((e) => e.tabId !== group.keepTabId).map((e) => e.tabId));
    if (targets.length === 0) return;
    if (!window.confirm('Close ' + targets.length + ' duplicate tab(s)? One per URL is kept.')) return;
    await closeTargets(targets);
  }

  function keepLabel(group: DuplicateGroup): string {
    return group.entries.some((e) => e.active) ? 'Keep current' : 'Keep oldest';
  }

  function summarize(res: { ok: boolean; payload?: unknown; error?: string }): string {
    if (!res.ok) return 'Close failed: ' + (res.error ?? 'unknown error');
    const outcome = parseCloseOutcome(res.payload);
    return outcome === null ? 'Close failed: unexpected response.' : describeCloseOutcome(outcome);
  }

  function hostOf(url: string): string {
    try {
      return new URL(url).host.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
</script>

<div class="flex min-h-0 flex-1 flex-col">
  <div class="flex shrink-0 items-center gap-2 border-b border-line px-3 py-2">
    <p class="num min-w-0 flex-1 text-[12px] text-dim">
      <span class="font-semibold {extraCount > 0 ? 'text-warn' : 'text-ink'}">{groups.length}</span>
      <span class="text-faint">group{groups.length === 1 ? '' : 's'} ·</span>
      {extraCount} extra
    </p>
    {#if extraCount > 0}
      <button
        class="shrink-0 rounded-md border border-bad/45 px-2 py-1 text-[11px] font-medium text-bad hover:bg-bad/10 disabled:opacity-40"
        disabled={busy}
        onclick={() => void closeAllExtras()}>Close extras</button
      >
    {/if}
  </div>

  {#if notice !== ''}
    <div class="flex items-start gap-1.5 border-b border-line px-3 py-1.5 text-[11px] text-dim" role="status">
      <Icon name="check" size={12} class="mt-0.5 shrink-0 text-good" />
      <p class="min-w-0 flex-1 break-words">{notice}</p>
    </div>
  {/if}

  <div class="min-h-0 flex-1 overflow-y-auto overscroll-contain">
    {#each groups as group (group.key)}
      <section class="border-b border-line/70">
        <div class="flex items-center gap-2 px-3 pt-2 pb-1">
          <p class="min-w-0 flex-1 truncate text-[12px] font-medium text-ink" title={group.label}>{group.label}</p>
          <button
            class="shrink-0 rounded border border-line px-1.5 py-0.5 text-[10px] font-medium text-dim hover:border-line-strong hover:text-ink disabled:opacity-40"
            disabled={busy}
            onclick={() => void closeTargets(group.entries.filter((e) => e.tabId !== group.keepTabId).map((e) => e.tabId))}>
            {keepLabel(group)}, close {group.entries.length - 1}
          </button>
        </div>
        <ul class="px-3 pb-1.5">
          {#each group.entries as entry (entry.tabId)}
            <li class="flex items-center gap-1.5 py-0.5">
              <span class="shrink-0 {entry.active ? 'text-awake' : entry.discarded ? 'text-asleep' : 'text-faint'}">
                <Icon name={entry.active ? 'sun' : entry.discarded ? 'zzz' : 'layers'} size={11} />
              </span>
              <span
                class="min-w-0 flex-1 truncate text-[11px] {entry.tabId === group.keepTabId ? 'text-ink' : 'text-dim'}"
                title={entry.title + ' — ' + entry.url}
              >
                {entry.title === '' ? entry.url : entry.title}
              </span>
              {#if entry.tabId === group.keepTabId}
                <span class="shrink-0 text-[9px] font-semibold uppercase tracking-wide text-good">keep</span>
              {:else}
                <span class="shrink-0 text-[9px] text-faint">{hostOf(entry.url)}</span>
                <button
                  class="shrink-0 rounded p-0.5 text-faint hover:text-bad disabled:opacity-40"
                  aria-label="Close duplicate tab"
                  title="Close this copy"
                  disabled={busy}
                  onclick={() => void closeTargets([entry.tabId])}><Icon name="close" size={11} /></button
                >
              {/if}
            </li>
          {/each}
        </ul>
      </section>
    {/each}
  </div>

  {#if !ready}
    <p class="px-3 py-4 text-center text-[12px] text-faint">Reading tabs…</p>
  {:else if groups.length === 0}
    <div class="px-4 py-6 text-center">
      <p class="text-[13px] text-ink">No duplicate tabs.</p>
      <p class="mt-1 text-[12px] text-dim">Every open URL appears exactly once. Nothing to tidy.</p>
    </div>
  {/if}
</div>
