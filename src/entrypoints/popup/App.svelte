<script lang="ts">
  import { sendToBackground } from '@/core/messaging';
  import { parseMarvellousSuspenderUrl } from '@/core/sanitize';
  import Icon from '@/lib/ui/Icon.svelte';

  let status: string = $state('');
  let statusKind: 'info' | 'bad' = $state('info');
  let busy: boolean = $state(false);
  let tmsCount: number = $state(0);

  $effect(() => {
    void detectTms();
  });

  async function detectTms(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    tmsCount = tabs.filter((t) => t.url !== undefined && parseMarvellousSuspenderUrl(t.url) !== null).length;
  }

  function say(message: string, kind: 'info' | 'bad' = 'info'): void {
    status = message;
    statusKind = kind;
  }

  async function snapshotNow(): Promise<void> {
    busy = true;
    const res = await sendToBackground({ type: 'snapshotNow' });
    if (res.ok) say('Snapshot saved.');
    else say(`Failed: ${res.error}`, 'bad');
    busy = false;
  }

  async function suspendInactive(): Promise<void> {
    busy = true;
    const res = await sendToBackground({ type: 'runSweep' });
    if (res.ok) say(`Suspended ${String((res.payload as { discarded?: number })?.discarded ?? 0)} tab(s).`);
    else say(`Failed: ${res.error}`, 'bad');
    busy = false;
  }

  async function migrateTms(): Promise<void> {
    busy = true;
    const res = await sendToBackground({ type: 'migrateTms' });
    if (res.ok) say(`Migrated ${String((res.payload as { migrated?: number })?.migrated ?? 0)} suspended tab(s).`);
    else say(`Failed: ${res.error}`, 'bad');
    busy = false;
    await detectTms();
  }

  async function openSidePanel(): Promise<void> {
    const win = await chrome.windows.getCurrent();
    if (win.id === undefined) return;
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  }

  function openSettings(): void {
    void chrome.runtime.openOptionsPage();
    window.close();
  }
</script>

<main class="flex w-[340px] flex-col gap-2 bg-surface p-3 text-ink">
  <header class="flex items-center gap-2">
    <h1 class="text-[15px] font-semibold text-ink">TabDorm</h1>
    <button
      class="ml-auto grid h-7 w-7 place-items-center rounded-md text-dim transition-colors duration-120 hover:bg-overlay hover:text-ink"
      aria-label="Open settings"
      title="Settings"
      onclick={openSettings}><Icon name="sliders" /></button
    >
  </header>

  {#if status !== ''}
    <div class="flex items-start gap-1.5 text-[12px] {statusKind === 'bad' ? 'text-bad' : 'text-dim'}" role="status">
      <Icon name={statusKind === 'bad' ? 'alert' : 'check'} size={12} class="mt-0.5 shrink-0" />
      <p class="min-w-0 flex-1 break-words">{status}</p>
    </div>
  {/if}

  <button
    class="flex w-full items-center justify-center gap-1.5 rounded-md bg-awake px-3 py-2 text-[13px] font-semibold text-on-awake transition-colors duration-120 hover:bg-accent-strong disabled:opacity-40"
    disabled={busy}
    onclick={() => void snapshotNow()}><Icon name="camera" size={14} /> Snapshot now</button
  >

  <button
    class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-dim transition-colors duration-120 hover:bg-overlay hover:text-ink disabled:opacity-40"
    disabled={busy}
    onclick={() => void suspendInactive()}>
    <Icon name="moon" size={14} class="shrink-0" />
    <span class="min-w-0 flex-1">Suspend inactive tabs</span>
  </button>

  <button
    class="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[13px] text-dim transition-colors duration-120 hover:bg-overlay hover:text-ink"
    onclick={() => void openSidePanel()}>
    <Icon name="layers" size={14} class="shrink-0" />
    <span class="min-w-0 flex-1">Open side panel</span>
    <Icon name="chevron" size={12} class="shrink-0 text-faint" />
  </button>

  {#if tmsCount > 0}
    <div class="mt-1 flex items-start gap-2 border-t border-warn/25 bg-warn/5 px-1 pt-2">
      <Icon name="alert" size={13} class="mt-0.5 shrink-0 text-warn" />
      <p class="min-w-0 flex-1 text-[12px] leading-snug text-dim">
        <span class="num font-semibold text-warn">{tmsCount}</span> suspended tab{tmsCount === 1 ? '' : 's'} from another
        suspender.
      </p>
      <button
        class="shrink-0 rounded-md border border-warn/45 px-2 py-0.5 text-[11px] font-semibold text-warn hover:bg-warn/10 disabled:opacity-40"
        disabled={busy}
        onclick={() => void migrateTms()}>Migrate</button
      >
    </div>
  {/if}
</main>
