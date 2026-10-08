<script lang="ts">
  import Toggle from '@/lib/ui/controls/Toggle.svelte';
  import NumberField from '@/lib/ui/controls/NumberField.svelte';
  import type { TabDormConfig } from '@/types';

  interface Props {
    config: TabDormConfig;
    onChange: (mutate: (draft: TabDormConfig) => void) => void;
  }

  let { config, onChange }: Props = $props();
</script>

<section id="restoration" class="scroll-mt-6 rounded-xl border border-line bg-raised p-5">
  <h2 class="text-xs font-semibold uppercase tracking-wider text-dim">Restoration</h2>
  <p class="mt-1 text-xs text-faint">How sessions are replayed when you hit Restore.</p>
  <div class="mt-2 divide-y divide-line/60">
    <NumberField
      value={config.restoration.batchSize}
      label="Batch size"
      hint="Tabs opened per batch while restoring."
      min={1}
      max={100}
      suffix="tabs"
      onChange={(v) => onChange((d) => (d.restoration.batchSize = v))}
    />
    <NumberField
      value={config.restoration.delayBetweenTabsMs}
      label="Delay between tabs"
      hint="Pacing between tab openings keeps big restores smooth."
      min={0}
      max={5000}
      suffix="ms"
      onChange={(v) => onChange((d) => (d.restoration.delayBetweenTabsMs = v))}
    />
    <Toggle
      checked={config.restoration.restoreAsDiscarded}
      label="Restore tabs asleep"
      hint="Tabs come back natively discarded and load when you click them."
      onChange={(v) => onChange((d) => (d.restoration.restoreAsDiscarded = v))}
    />
    <Toggle
      checked={config.restoration.restoreGroupsCollapsed}
      label="Restore groups collapsed"
      onChange={(v) => onChange((d) => (d.restoration.restoreGroupsCollapsed = v))}
    />
    <Toggle
      checked={config.restoration.clampToBounds}
      label="Clamp restored windows to the screen"
      hint="Off-screen or oversized windows are pulled back into the visible desktop."
      onChange={(v) => onChange((d) => (d.restoration.clampToBounds = v))}
    />
  </div>
</section>
