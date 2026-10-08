<script lang="ts">
  import { sendToBackground } from '@/core/messaging';

  let status: string = $state('');
  let busy: boolean = $state(false);

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

  async function openSidePanel(): Promise<void> {
    const win = await chrome.windows.getCurrent();
    if (win.id === undefined) return;
    await chrome.sidePanel.open({ windowId: win.id });
    window.close();
  }

</script>

<main class="flex flex-col gap-2 p-3 text-sm">
  <h1 class="text-base font-semibold tracking-tight text-neutral-100">TabDorm</h1>
  {#if status !== ''}
    <p class="rounded-md bg-neutral-800 px-2 py-1 text-xs text-neutral-300" role="status">{status}</p>
  {/if}
  <button
    class="rounded-md bg-indigo-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-indigo-500 disabled:opacity-50"
    disabled={busy}
    onclick={() => void snapshotNow()}>Snapshot now</button
  >
  <button
    class="rounded-md bg-neutral-800 px-3 py-1.5 text-xs font-medium text-neutral-200 hover:bg-neutral-700 disabled:opacity-50"
    disabled={busy}
    onclick={() => void suspendInactive()}>Suspend inactive tabs</button
  >
  <button
    class="rounded-md border border-neutral-700 px-3 py-1.5 text-xs font-medium text-neutral-300 hover:bg-neutral-800"
    onclick={() => void openSidePanel()}>Open side panel</button
  >
</main>
