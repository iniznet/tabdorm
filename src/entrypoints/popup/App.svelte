<script lang="ts">
  import { sendToBackground } from '@/core/messaging';
  import { parseMarvellousSuspenderUrl } from '@/core/sanitize';

  let status: string = $state('');
  let busy: boolean = $state(false);
  let tmsCount: number = $state(0);

  $effect(() => {
    void detectTms();
  });

  async function detectTms(): Promise<void> {
    const tabs = await chrome.tabs.query({});
    tmsCount = tabs.filter((t) => t.url !== undefined && parseMarvellousSuspenderUrl(t.url) !== null).length;
  }

  async function snapshotNow(): Promise<void> {
    busy = true;
    const res = await sendToBackground({ type: 'snapshotNow' });
    status = res.ok ? 'Snapshot saved.' : `Failed: ${res.error}`;
    busy = false;
  }

  async function suspendInactive(): Promise<void> {
    busy = true;
    const res = await sendToBackground({ type: 'runSweep' });
    status = res.ok
      ? `Suspended ${String((res.payload as { discarded?: number })?.discarded ?? 0)} tab(s).`
      : `Failed: ${res.error}`;
    busy = false;
  }

  async function migrateTms(): Promise<void> {
    busy = true;
    const res = await sendToBackground({ type: 'migrateTms' });
    status = res.ok
      ? `Migrated ${String((res.payload as { migrated?: number })?.migrated ?? 0)} suspended tab(s).`
      : `Failed: ${res.error}`;
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

  const SECONDARY = 'rounded-md border border-line px-3 py-1.5 text-xs font-medium text-dim hover:border-faint hover:text-ink disabled:opacity-50';
</script>

<main class="flex flex-col gap-2 p-3 text-sm">
  <header class="flex items-center justify-between">
    <h1 class="text-base font-semibold tracking-tight text-ink">TabDorm</h1>
    <button
      class="grid h-7 w-7 place-items-center rounded-md border border-line text-dim hover:border-faint hover:text-ink"
      aria-label="Open settings"
      title="Settings"
      onclick={openSettings}>⚙</button
    >
  </header>
  {#if status !== ''}
    <p class="rounded-md bg-overlay px-2 py-1 text-xs text-dim" role="status">{status}</p>
  {/if}
  <button
    class="rounded-md bg-accent px-3 py-1.5 text-xs font-medium text-white hover:bg-accent-strong disabled:opacity-50"
    disabled={busy}
    onclick={() => void snapshotNow()}>Snapshot now</button
  >
  <button class={SECONDARY} disabled={busy} onclick={() => void suspendInactive()}>Suspend inactive tabs</button>
  {#if tmsCount > 0}
    <button
      class="rounded-md border border-warn/50 px-3 py-1.5 text-xs font-medium text-warn hover:bg-warn/10 disabled:opacity-50"
      disabled={busy}
      onclick={() => void migrateTms()}>Migrate {tmsCount} suspended tab{tmsCount === 1 ? '' : 's'}</button
    >
  {/if}
  <button class={SECONDARY} onclick={() => void openSidePanel()}>Open side panel</button>
</main>
