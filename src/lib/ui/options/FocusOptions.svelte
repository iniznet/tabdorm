<script lang="ts">
  import SelectField from '@/lib/ui/controls/SelectField.svelte';
  import NumberField from '@/lib/ui/controls/NumberField.svelte';
  import type { CloseFocusMode, TabDormConfig } from '@/types';

  interface Props {
    config: TabDormConfig;
    onChange: (mutate: (draft: TabDormConfig) => void) => void;
  }

  let { config, onChange }: Props = $props();

  const MODES = [
    { value: 'browser', label: 'Browser default (neighbour tab)' },
    { value: 'previous-tab', label: 'Previous tab you were on' },
    { value: 'previous-other-group', label: 'Previous tab outside the group' },
  ] as const;
</script>

<section id="focus" class="scroll-mt-20 border-t border-line pt-5">
  <h2 class="text-[15px] font-semibold text-ink">Focus after close</h2>
  <p class="mt-1 text-[12px] text-dim">Which tab becomes active when you close the tab you are looking at.</p>
  <div class="mt-3 divide-y divide-line/70">
    <SelectField
      value={config.focus.onActiveTabClosed}
      label="When the active tab is closed"
      hint="Chrome activates the neighbouring tab — often another tab of the same group. The history modes return you to the tab you came from instead."
      options={MODES}
      onChange={(value) => onChange((d) => (d.focus.onActiveTabClosed = value as CloseFocusMode))}
    />
    <NumberField
      value={config.focus.historyDepth}
      label="Activation history depth"
      hint="How many recent tabs per window the restore may walk back through."
      min={1}
      max={25}
      suffix="tabs"
      onChange={(v) => onChange((d) => (d.focus.historyDepth = v))}
    />
    <NumberField
      value={config.focus.restoreSettleMs}
      label="Restore grace window"
      hint="0 disables the correction. A short window re-applies your restore if Chrome activates its own pick afterwards."
      min={0}
      max={2000}
      suffix="ms"
      onChange={(v) => onChange((d) => (d.focus.restoreSettleMs = v))}
    />
  </div>
</section>
