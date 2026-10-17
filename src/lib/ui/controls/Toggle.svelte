<script lang="ts">
  interface Props {
    checked: boolean;
    label: string;
    hint?: string;
    disabled?: boolean;
    onChange: (value: boolean) => void;
  }

  let { checked, label, hint, disabled = false, onChange }: Props = $props();
</script>

<div class="flex items-start justify-between gap-4 py-2.5">
  <span class="min-w-0">
    <span class="block text-[13px] text-ink">{label}</span>
    {#if hint !== undefined}<span class="mt-0.5 block max-w-[60ch] text-[12px] leading-snug text-dim">{hint}</span>{/if}
  </span>
  <button
    type="button"
    role="switch"
    aria-checked={checked}
    aria-label={label}
    {disabled}
    class="relative mt-0.5 h-5 w-9 shrink-0 rounded-full transition-colors duration-120 {checked
      ? 'bg-awake'
      : 'bg-line-strong'} disabled:cursor-not-allowed disabled:opacity-40"
    onclick={() => onChange(!checked)}
  >
    <span
      class="absolute top-0.5 h-4 w-4 rounded-full transition-all duration-120 {checked
        ? 'left-[18px] bg-on-awake'
        : 'left-0.5 bg-dim'}"></span>
  </button>
</div>
