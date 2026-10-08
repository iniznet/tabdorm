<script lang="ts">
  import { getConfig, saveConfig } from '@/core/config-store';
  import { resolveConfig, type TabDormConfig } from '@/types';
  import Section from '@/lib/ui/controls/Section.svelte';
  import SuspensionOptions from '@/lib/ui/options/SuspensionOptions.svelte';
  import GroupsOptions from '@/lib/ui/options/GroupsOptions.svelte';
  import RestorationOptions from '@/lib/ui/options/RestorationOptions.svelte';
  import SnapshotsOptions from '@/lib/ui/options/SnapshotsOptions.svelte';
  import DangerZone from '@/lib/ui/options/DangerZone.svelte';

  let config: TabDormConfig | null = $state(null);
  let savedFlash = $state(false);
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  $effect(() => {
    void load();
  });

  async function load(): Promise<void> {
    config = await getConfig();
  }

  /** Single write path: mutate a snapshot, re-validate through resolveConfig, persist. */
  function update(mutate: (draft: TabDormConfig) => void): void {
    if (config === null) return;
    const draft = structuredClone($state.snapshot(config)) as TabDormConfig;
    mutate(draft);
    const resolved = resolveConfig(draft);
    config = resolved;
    void saveConfig(resolved).then(() => {
      savedFlash = true;
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => (savedFlash = false), 1500);
    });
  }

  function onImported(imported: TabDormConfig): void {
    config = imported;
  }

  const NAV = [
    ['suspension', 'Suspension'],
    ['groups', 'Tab groups'],
    ['restoration', 'Restoration'],
    ['snapshots', 'Snapshots'],
    ['data', 'Data & backup'],
  ] as const;
</script>

{#if config !== null}
  <div class="mx-auto max-w-2xl px-6 py-8">
    <header class="mb-6 flex items-center justify-between">
      <div>
        <h1 class="text-xl font-semibold tracking-tight text-ink">TabDorm Settings</h1>
        <p class="mt-1 text-xs text-faint">Every change applies live — the background resyncs its alarms automatically.</p>
      </div>
      <span
        class="rounded-full border px-2.5 py-1 text-xs transition-opacity {savedFlash
          ? 'border-good/40 text-good opacity-100'
          : 'opacity-0'}">Saved ✓</span
      >
    </header>

    <nav class="mb-6 flex flex-wrap gap-2" aria-label="Settings sections">
      {#each NAV as [id, label] (id)}
        <a
          href="#{id}"
          class="rounded-full border border-line bg-raised px-3 py-1 text-xs text-dim hover:border-faint hover:text-ink">{label}</a
        >
      {/each}
    </nav>

    <div class="flex flex-col gap-4">
      <SuspensionOptions {config} onChange={update} />
      <GroupsOptions {config} onChange={update} />
      <RestorationOptions {config} onChange={update} />
      <SnapshotsOptions {config} onChange={update} />
      <Section id="data" title="Data & backup" description="Destructive operations. Export first — there is no undo.">
        <DangerZone {config} onImported={onImported} />
      </Section>
    </div>
  </div>
{:else}
  <div class="grid h-screen place-items-center text-sm text-faint">Loading settings…</div>
{/if}
