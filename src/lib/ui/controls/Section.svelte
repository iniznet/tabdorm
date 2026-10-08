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

<section {id} class="scroll-mt-6 rounded-xl border border-line bg-raised p-5">
  <h2 class="text-xs font-semibold uppercase tracking-wider text-dim">{title}</h2>
  {#if description !== undefined}<p class="mt-1 text-xs leading-snug text-faint">{description}</p>{/if}
  <div class="mt-2 divide-y divide-line/60">{@render children()}</div>
</section>
