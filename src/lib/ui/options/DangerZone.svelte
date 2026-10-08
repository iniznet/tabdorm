<script lang="ts">
  import { saveConfig } from '@/core/config-store';
  import { clearAllSessions } from '@/core/db';
  import { resolveConfig, type TabDormConfig } from '@/types';

  interface Props {
    config: TabDormConfig;
    onImported: (config: TabDormConfig) => void;
  }

  let { config, onImported }: Props = $props();

  let note = $state('');
  let fileInput: HTMLInputElement | undefined = $state();

  function download(filename: string, data: string): void {
    const url = URL.createObjectURL(new Blob([data], { type: 'application/json' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  function exportConfig(): void {
    download('tabdorm-config.json', JSON.stringify(config, null, 2));
    note = 'Config exported.';
  }

  async function importConfig(file: File): Promise<void> {
    try {
      const parsed: unknown = JSON.parse(await file.text());
      const resolved = resolveConfig(parsed);
      await saveConfig(resolved);
      onImported(resolved);
      note = 'Config imported.';
    } catch (error) {
      note = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
    } finally {
      if (fileInput !== undefined) fileInput.value = '';
    }
  }

  async function resetConfig(): Promise<void> {
    if (!window.confirm('Reset ALL settings to defaults?')) return;
    const resolved = resolveConfig(undefined);
    await saveConfig(resolved);
    onImported(resolved);
    note = 'Settings reset to defaults.';
  }

  async function clearHistory(): Promise<void>
    {
    if (!window.confirm('Delete EVERY stored session (snapshots, closed windows, saved sessions)? This cannot be undone.')) return;
    const removed = await clearAllSessions();
    note = `Deleted ${removed} session(s).`;
  }

  const BTN_DANGER = 'rounded-md border border-bad/50 px-3 py-1.5 text-xs font-medium text-bad hover:bg-bad/10';
  const BTN_NEUTRAL = 'rounded-md border border-line px-3 py-1.5 text-xs font-medium text-dim hover:border-faint hover:text-ink';
</script>

<div class="divide-y divide-line/60">
  <div class="flex items-center justify-between gap-3 py-2.5">
    <span class="min-w-0">
      <span class="block text-sm text-ink">Config file</span>
      <span class="mt-0.5 block text-xs text-faint">Export all settings as JSON, or import a previously exported file.</span>
    </span>
    <span class="flex shrink-0 gap-2">
      <button class={BTN_NEUTRAL} onclick={exportConfig}>Export</button>
      <button class={BTN_NEUTRAL} onclick={() => fileInput?.click()}>Import</button>
      <input
        bind:this={fileInput}
        type="file"
        accept="application/json,.json"
        class="hidden"
        onchange={(e) => {
          const file = e.currentTarget.files?.[0];
          if (file !== undefined) void importConfig(file);
        }}
      />
    </span>
  </div>

  <div class="flex items-center justify-between gap-3 py-2.5">
    <span class="min-w-0">
      <span class="block text-sm text-ink">Reset settings</span>
      <span class="mt-0.5 block text-xs text-faint">Restore every knob to its safe default. Sessions are kept.</span>
    </span>
    <button class={BTN_DANGER} onclick={() => void resetConfig()}>Reset</button>
  </div>

  <div class="flex items-center justify-between gap-3 py-2.5">
    <span class="min-w-0">
      <span class="block text-sm text-ink">Clear session history</span>
      <span class="mt-0.5 block text-xs text-faint">Deletes all snapshots, saved sessions, and closed-window records.</span>
    </span>
    <button class={BTN_DANGER} onclick={() => void clearHistory()}>Clear</button>
  </div>

  {#if note !== ''}
    <p class="py-2.5 text-xs text-dim" role="status">{note}</p>
  {/if}
</div>
