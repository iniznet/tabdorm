<script lang="ts">
  import { findDuplicateGroups, type DuplicateGroup } from '@/core/duplicates';
  import type { CloseDuplicateOutcome } from '@/core/close-duplicates';
  import { sendToBackground } from '@/core/messaging';

  let groups: DuplicateGroup[] = $state([]);
  let open: boolean = $state(false);
  let busy: boolean = $state(false);
  let notice: string = $state('');

  const extraCount = $derived(groups.reduce((sum, group) => sum + group.entries.length - 1, 0));

  function isCloseOutcome(payload: unknown): payload is CloseDuplicateOutcome {
    if (typeof payload !== 'object' || payload === null) return false;
    const p = payload as Record<string, unknown>;
    if (!Array.isArray(p['closed']) || !p['closed'].every((n) => typeof n === 'number')) return false;
    if (!Array.isArray(p['skipped'])) return false;
    return p['skipped'].every((s) => typeof s === 'object' && s !== null && typeof (s as Record<string, unknown>)['tabId'] === 'number' && typeof (s as Record<string, unknown>)['reason'] === 'string');
  }

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

  function keepLabel(group: DuplicateGroup): string {
    return group.entries.some((e) => e.active) ? 'Keep current' : 'Keep oldest';
  }

  function summarize(res: { ok: boolean; payload?: unknown; error?: string }): string {
    if (!res.ok) return 'Close failed: ' + (res.error ?? 'unknown error');
    if (!isCloseOutcome(res.payload)) return 'Close failed: unexpected response.';
    const outcome: CloseDuplicateOutcome = res.payload;
    const keptNote = outcome.skipped.some((s) => s.reason === 'active') ? ' · active tab kept' : '';
    const formNote = outcome.skipped.filter((s) => s.reason === 'unsaved-form').length;
    const formStr = formNote > 0 ? ` · ${formNote} skipped (unsaved form)` : '';
    return `Closed ${res.payload.closed.length} duplicate tab(s)${keptNote}${formStr}.`;
  }
</script>

{#if groups.length > 0}
  <div class="rounded-md border border-warn/40 bg-warn/10">
    <button
      class="flex w-full items-center gap-2 px-2 py-1.5 text-left"
      onclick={() => (open = !open)}
      aria-expanded={open}
      aria-controls="duplicates-list">
      <span class="min-w-0 flex-1 truncate text-xs font-semibold text-warn">
        {groups.length} duplicate group{groups.length === 1 ? '' : 's'} · {extraCount} extra tab{extraCount === 1 ? '' : 's'}
      </span>
      <span class="text-[10px] text-warn">{open ? '▾' : '▸'}</span>
    </button>
    {#if open}
      <div class="max-h-40 overflow-y-auto border-t border-warn/30 px-2 py-1.5" id="duplicates-list">
        {#if notice !== ''}
          <p class="mb-1.5 rounded bg-overlay px-2 py-1 text-xs text-dim" role="status">{notice}</p>
        {/if}
        {#each groups as group (group.key)}
          <div class="mb-1.5 last:mb-0">
            <div class="flex items-center gap-2">
              <p class="min-w-0 flex-1 truncate text-[11px] text-ink" title={group.label}>{group.label}</p>
              <button
                class="shrink-0 rounded border border-warn/50 px-1.5 py-0.5 text-[10px] font-medium text-warn hover:bg-warn/20 disabled:opacity-50"
                disabled={busy}
                onclick={() => void closeTargets(group.entries.filter((e) => e.tabId !== group.keepTabId).map((e) => e.tabId))}>
                {keepLabel(group)}, close {group.entries.length - 1}
              </button>
            </div>
            <ul class="mt-0.5 space-y-0.5">
              {#each group.entries as entry (entry.tabId)}
                <li class="flex items-center gap-1.5 text-[10px] leading-tight">
                  <span class="shrink-0 {entry.active ? 'text-good' : 'text-faint'}" title={entry.active ? 'Active tab' : undefined}>
                    {entry.active ? '●' : entry.pinned ? '📌' : entry.discarded ? '💤' : '○'}
                  </span>
                  <span class="min-w-0 flex-1 truncate {entry.tabId === group.keepTabId ? 'text-good' : 'text-dim'}" title={entry.title + ' — ' + entry.url}>
                    {entry.title === '' ? entry.url : entry.title}
                  </span>
                  {#if entry.tabId === group.keepTabId}
                    <span class="shrink-0 text-[9px] uppercase tracking-wide text-good">keep</span>
                  {:else}
                    <button
                      class="shrink-0 text-faint hover:text-bad disabled:opacity-50"
                      aria-label="Close duplicate tab"
                      disabled={busy}
                      onclick={() => void closeTargets([entry.tabId])}>×</button
                    >
                  {/if}
                </li>
              {/each}
            </ul>
          </div>
        {/each}
      </div>
    {/if}
  </div>
{/if}
