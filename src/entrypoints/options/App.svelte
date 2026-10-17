<script lang="ts">
  import { getConfig, saveConfig } from '@/core/config-store';
  import { resolveConfig, type TabDormConfig } from '@/types';
  import Section from '@/lib/ui/controls/Section.svelte';
  import Icon from '@/lib/ui/Icon.svelte';
  import SuspensionOptions from '@/lib/ui/options/SuspensionOptions.svelte';
  import GroupsOptions from '@/lib/ui/options/GroupsOptions.svelte';
  import FocusOptions from '@/lib/ui/options/FocusOptions.svelte';
  import RestorationOptions from '@/lib/ui/options/RestorationOptions.svelte';
  import StaleOptions from '@/lib/ui/options/StaleOptions.svelte';
  import SnapshotsOptions from '@/lib/ui/options/SnapshotsOptions.svelte';
  import DangerZone from '@/lib/ui/options/DangerZone.svelte';

  let config: TabDormConfig | null = $state(null);
  let savedFlash = $state(false);
  let saveError = $state<string | null>(null);
  let activeId = $state('suspension');
  let flashTimer: ReturnType<typeof setTimeout> | undefined;

  const NAV = [
    ['suspension', 'Suspension'],
    ['groups', 'Tab groups'],
    ['focus', 'Focus after close'],
    ['stale', 'Stale tabs'],
    ['restoration', 'Restoration'],
    ['snapshots', 'Snapshots'],
    ['data', 'Data & backup'],
  ] as const;

  $effect(() => {
    void load();
  });

  /** Highlights the section currently in view, so the rail is a position, not a menu. */
  $effect(() => {
    if (config === null) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting && entry.target.id !== '') activeId = entry.target.id;
        }
      },
      { rootMargin: '-15% 0px -70% 0px', threshold: 0 },
    );
    for (const [id] of NAV) {
      const element = document.getElementById(id);
      if (element !== null) observer.observe(element);
    }
    return () => observer.disconnect();
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
    saveError = null;
    void saveConfig(resolved).then(
      () => {
        savedFlash = true;
        clearTimeout(flashTimer);
        flashTimer = setTimeout(() => (savedFlash = false), 1500);
      },
      (error: unknown) => {
        saveError = error instanceof Error ? error.message : String(error);
      },
    );
  }

  function onImported(imported: TabDormConfig): void {
    config = imported;
  }
</script>

{#if config !== null}
  <div class="flex min-h-screen bg-surface text-ink">
    <aside class="sticky top-0 hidden h-screen w-[196px] shrink-0 border-r border-line px-3 py-5 min-[760px]:block">
      <p class="px-2 text-[13px] font-semibold">TabDorm</p>
      <p class="px-2 text-[11px] text-faint">Settings</p>
      <nav class="mt-4 flex flex-col gap-0.5" aria-label="Settings sections">
        {#each NAV as [id, label] (id)}
          <a
            href="#{id}"
            class="relative rounded-md px-2 py-1.5 text-[12px] transition-colors duration-120 {activeId === id
              ? 'bg-overlay text-ink'
              : 'text-dim hover:bg-overlay/60 hover:text-ink'}"
          >
            {#if activeId === id}<span class="absolute inset-y-1 left-0 w-0.5 rounded-full bg-awake"></span>{/if}
            {label}
          </a>
        {/each}
      </nav>
    </aside>

    <div class="flex min-w-0 flex-1 flex-col">
      <header class="sticky top-0 z-10 border-b border-line bg-raised/95 backdrop-blur-sm">
        <div class="flex items-center gap-3 px-4 py-2.5">
          <h1 class="text-[15px] font-semibold text-ink">Settings</h1>
          <span class="hidden text-[12px] text-faint sm:inline">Every change applies live.</span>
          <span
            class="ml-auto flex items-center gap-1 text-[11px] text-good transition-opacity duration-200 {savedFlash
              ? 'opacity-100'
              : 'opacity-0'}"
          >
            <Icon name="check" size={12} /> Saved
          </span>
        </div>
        <nav class="-mx-px flex gap-0 overflow-x-auto px-4 pb-1 min-[760px]:hidden" aria-label="Settings sections">
          {#each NAV as [id, label] (id)}
            <a
              href="#{id}"
              class="relative shrink-0 px-2 pb-1.5 pt-1 text-[12px] {activeId === id ? 'text-ink' : 'text-dim'}">
              {label}
              {#if activeId === id}<span class="absolute inset-x-1.5 -bottom-px h-px bg-awake"></span>{/if}
            </a>
          {/each}
        </nav>
      </header>

      {#if saveError !== null}
        <div class="flex items-start gap-2 border-b border-bad/40 bg-bad/10 px-4 py-2 text-[12px] text-bad" role="alert">
          <Icon name="alert" size={13} class="mt-0.5 shrink-0" />
          <p class="min-w-0 flex-1 break-words">{saveError}</p>
        </div>
      {/if}

      <main class="mx-auto flex w-full max-w-[680px] flex-col gap-8 px-4 py-6 pb-16">
        <SuspensionOptions {config} onChange={update} />
        <GroupsOptions {config} onChange={update} />
        <FocusOptions {config} onChange={update} />
        <StaleOptions {config} onChange={update} />
        <RestorationOptions {config} onChange={update} />
        <SnapshotsOptions {config} onChange={update} />
        <Section id="data" title="Data & backup" description="Destructive operations. Export first — there is no undo.">
          <DangerZone {config} onImported={onImported} />
        </Section>
      </main>
    </div>
  </div>
{:else}
  <div class="grid h-screen place-items-center bg-surface text-[13px] text-faint">Loading settings…</div>
{/if}
