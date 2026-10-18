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

<section id="restoration" class="scroll-mt-20 border-t border-line pt-5">
  <h2 class="text-[15px] font-semibold text-ink">Restoration</h2>
  <p class="mt-1 text-[12px] text-dim">How sessions are replayed when you hit Restore.</p>
  <div class="mt-3 divide-y divide-line/70">
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
    <Toggle
      checked={config.restoration.nativeRestoreGuard}
      label="Keep tabs asleep on Ctrl+Shift+T"
      hint="Reopening a closed window with the browser's own restore re-discards the tabs that were asleep when it closed, instead of loading them all."
      onChange={(v) => onChange((d) => (d.restoration.nativeRestoreGuard = v))}
    />
    <NumberField
      value={config.restoration.nativeRestoreGuardWindowMinutes}
      label="Guard window"
      hint="How long after closing a window its snapshot can still match a native restore."
      min={1}
      max={10080}
      suffix="min"
      onChange={(v) => onChange((d) => (d.restoration.nativeRestoreGuardWindowMinutes = v))}
    />
    <NumberField
      value={config.restoration.nativeRestoreGuardMinTabs}
      label="Guard minimum tabs"
      hint="Windows with fewer tabs are never matched by the guard."
      min={2}
      max={500}
      suffix="tabs"
      onChange={(v) => onChange((d) => (d.restoration.nativeRestoreGuardMinTabs = v))}
    />
    <NumberField
      value={config.restoration.nativeRestoreGuardMatchPct}
      label="Guard match ratio"
      hint="Percentage of tabs that must line up with the closed snapshot."
      min={50}
      max={100}
      suffix="%"
      onChange={(v) => onChange((d) => (d.restoration.nativeRestoreGuardMatchPct = v))}
    />
  </div>
</section>
