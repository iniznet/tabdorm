<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    id: string;
    title: string;
    description?: string;
    children: Snippet;
  }

  let { id, title, description, children }: Props = $props();
</script>

<section {id} class="scroll-mt-20 border-t border-line pt-5 first:border-t-0 first:pt-0">
  <h2 class="text-[15px] font-semibold text-ink">{title}</h2>
  {#if description !== undefined}<p class="mt-1 max-w-[65ch] text-[12px] leading-snug text-dim">{description}</p>{/if}
  <div class="mt-3 divide-y divide-line/70">{@render children()}</div>
</section>
