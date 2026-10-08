<script lang="ts">
  interface Option {
    value: string;
    label: string;
  }

  interface Props {
    value: string;
    label: string;
    hint?: string;
    options: readonly Option[];
    onChange: (value: string) => void;
  }

  let { value, label, hint, options, onChange }: Props = $props();
</script>

<div class="flex items-start justify-between gap-3 py-2.5">
  <span class="min-w-0">
    <span class="block text-sm text-ink">{label}</span>
    {#if hint !== undefined}<span class="mt-0.5 block text-xs leading-snug text-faint">{hint}</span>{/if}
  </span>
  <select
    class="shrink-0 rounded-md border border-line bg-overlay px-2 py-1 text-sm text-ink hover:border-faint"
    {value}
    onchange={(e) => onChange(e.currentTarget.value)}
  >
    {#each options as option (option.value)}
      <option value={option.value}>{option.label}</option>
    {/each}
  </select>
</div>
