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

<section id="snapshots" class="scroll-mt-6 rounded-xl border border-line bg-raised p-5">
  <h2 class="text-xs font-semibold uppercase tracking-wider text-dim">Snapshots</h2>
  <p class="mt-1 text-xs text-faint">Automatic snapshots deduplicate — an unchanged browser state never piles up history. User-saved and closed-window sessions are never auto-deleted.</p>
  <div class="mt-2 divide-y divide-line/60">
    <Toggle
      checked={config.snapshots.enabled}
      label="Enable automatic snapshots"
      onChange={(v) => onChange((d) => (d.snapshots.enabled = v))}
    />
    <NumberField
      value={config.snapshots.intervalMinutes}
      label="Snapshot interval"
      min={1}
      max={1440}
      suffix="min"
      onChange={(v) => onChange((d) => (d.snapshots.intervalMinutes = v))}
    />
    <NumberField
      value={config.snapshots.maxSnapshotsRetained}
      label="Retention cap"
      hint="Oldest auto-snapshots beyond this count are pruned."
      min={1}
      max={10000}
      suffix="snapshots"
      onChange={(v) => onChange((d) => (d.snapshots.maxSnapshotsRetained = v))}
    />
    <NumberField
      value={config.snapshots.retentionDays}
      label="Retention age"
      min={1}
      max={3650}
      suffix="days"
      onChange={(v) => onChange((d) => (d.snapshots.retentionDays = v))}
    />
    <NumberField
      value={config.snapshots.autoBackupDownloadDays}
      label="Auto-backup download"
      hint="Downloads a JSON backup of all sessions to your Downloads folder every N days. 0 disables."
      min={0}
      max={365}
      suffix="days"
      onChange={(v) => onChange((d) => (d.snapshots.autoBackupDownloadDays = v))}
    />
  </div>
</section>
