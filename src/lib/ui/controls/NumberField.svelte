<script lang="ts">
  interface Props {
    value: number;
    label: string;
    hint?: string;
    min?: number;
    max?: number;
    suffix?: string;
    onChange: (value: number) => void;
  }

  let { value, label, hint, min, max, suffix, onChange }: Props = $props();

  /** Commits on blur/Enter: clamps to bounds and forces the clamped value back into the DOM. */
  function commit(event: Event): void {
    const input = event.currentTarget as HTMLInputElement;
    let next = Math.trunc(Number(input.value));
    if (!Number.isFinite(next)) next = value;
    if (min !== undefined) next = Math.max(min, next);
    if (max !== undefined) next = Math.min(max, next);
    onChange(next);
    input.value = String(next);
  }
</script>

<div class="flex items-start justify-between gap-3 py-2.5">
  <span class="min-w-0">
    <span class="block text-sm text-ink">{label}</span>
    {#if hint !== undefined}<span class="mt-0.5 block text-xs leading-snug text-faint">{hint}</span>{/if}
  </span>
  <span class="flex shrink-0 items-center gap-1.5">
    <input
      type="number"
      class="w-20 rounded-md border border-line bg-overlay px-2 py-1 text-right text-sm text-ink hover:border-faint"
      {value}
      {min}
      {max}
      onchange={commit}
      onkeydown={(e) => {
        if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
      }}
    />
    {#if suffix !== undefined}<span class="w-10 text-xs text-faint">{suffix}</span>{/if}
  </span>
</div>
