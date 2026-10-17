<script lang="ts">
  import NumberField from '@/lib/ui/controls/NumberField.svelte';
  import type { TabDormConfig } from '@/types';

  interface Props {
    config: TabDormConfig;
    onChange: (mutate: (draft: TabDormConfig) => void) => void;
  }

  let { config, onChange }: Props = $props();
</script>

<section id="stale" class="scroll-mt-6 rounded-xl border border-line bg-raised p-5">
  <h2 class="text-xs font-semibold uppercase tracking-wider text-dim">Stale tabs</h2>
  <p class="mt-1 text-xs text-faint">TabDorm remembers when you last looked at each tab, so the side panel can list what you have been collecting and not revisiting.</p>
  <div class="mt-2 divide-y divide-line/60">
    <NumberField
      value={config.stale.staleAfterDays}
      label="Flag a tab as stale after"
      hint="Days without being viewed. 0 disables flagging — the Stale view still lists every tab by last visit."
      min={0}
      max={365}
      suffix="days"
      onChange={(v) => onChange((d) => (d.stale.staleAfterDays = v))}
    />
  </div>
</section>
