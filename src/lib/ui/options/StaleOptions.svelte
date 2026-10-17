<script lang="ts">
  import NumberField from '@/lib/ui/controls/NumberField.svelte';
  import type { TabDormConfig } from '@/types';

  interface Props {
    config: TabDormConfig;
    onChange: (mutate: (draft: TabDormConfig) => void) => void;
  }

  let { config, onChange }: Props = $props();
</script>

<section id="stale" class="scroll-mt-20 border-t border-line pt-5">
  <h2 class="text-[15px] font-semibold text-ink">Stale tabs</h2>
  <p class="mt-1 text-[12px] text-dim">TabDorm remembers when you last looked at each tab, so the side panel can list what you have been collecting and not revisiting.</p>
  <div class="mt-3 divide-y divide-line/70">
    <NumberField
      value={config.stale.staleAfterHours}
      label="Flag a tab as stale after"
      hint="Hours without being viewed. 168 = one week, 12 = half a day. 0 disables flagging — the Stale view still lists every tab by last visit."
      min={0}
      max={8760}
      suffix="hours"
      onChange={(v) => onChange((d) => (d.stale.staleAfterHours = v))}
    />
  </div>
</section>
