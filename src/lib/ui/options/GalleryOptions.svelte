<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@/lib/ui/Icon.svelte';
  import { formatByteSize, nextGalleryWindow } from '@/core/image-cache';
  import { imageGalleryPage, imageTotals } from '@/core/image-store';
  import type { CachedImage, TabDormConfig } from '@/types';

  interface Props {
    config: TabDormConfig;
    onChange: (mutate: (draft: TabDormConfig) => void) => void;
  }

  let { config, onChange }: Props = $props();

  /** Cards per fetch. Presentation only, so it is not a config knob. */
  const PAGE_SIZE = 24;
  const SKELETONS = [0, 1, 2, 3, 4, 5, 6, 7];

  interface Card {
    key: string;
    host: string;
    pageUrl: string;
    size: number;
    savedAt: number;
    url: string;
  }

  let cards = $state<Card[]>([]);
  let total = $state(0);
  let bytes = $state(0);
  let loading = $state(true);
  let error = $state('');
  let selected = $state<Card | null>(null);
  let closeButton = $state<HTMLButtonElement | null>(null);
  let permissionNote = $state('');

  /** Live object URLs, revoked on refresh and on teardown so no blob is pinned. */
  const liveUrls = new Set<string>();

  function revokeAll(): void {
    for (const url of liveUrls) URL.revokeObjectURL(url);
    liveUrls.clear();
  }

  function toCard(row: CachedImage): Card {
    const url = URL.createObjectURL(row.blob);
    liveUrls.add(url);
    return { key: row.key, host: row.host, pageUrl: row.pageUrl, size: row.size, savedAt: row.savedAt, url };
  }

  function formatDay(ts: number): string {
    return new Date(ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  }

  function formatSaved(ts: number): string {
    return new Date(ts).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
  }

  async function loadMore(): Promise<void> {
    const window = nextGalleryWindow(total, cards.length, PAGE_SIZE);
    if (window.limit === 0) return;
    loading = true;
    try {
      const rows = await imageGalleryPage(window.offset, window.limit);
      cards = [...cards, ...rows.map(toCard)];
      error = '';
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The cache could not be read.';
    } finally {
      loading = false;
    }
  }

  async function reload(): Promise<void> {
    revokeAll();
    cards = [];
    total = 0;
    bytes = 0;
    loading = true;
    error = '';
    try {
      const totals = await imageTotals();
      total = totals.count;
      bytes = totals.bytes;
      await loadMore();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The cache could not be read.';
      loading = false;
    }
  }

  function close(): void {
    selected = null;
  }

  /**
   * Capture reads the page DOM before a discard, which needs the optional broad
   * grant. The write goes through the parent's onChange, the single config path;
   * a refused grant keeps the cache off and says so.
   */
  async function enableCache(): Promise<void> {
    permissionNote = '';
    const granted = await chrome.permissions.request({ permissions: ['scripting'], origins: ['<all_urls>'] });
    if (!granted) {
      permissionNote = 'Permission not granted, so the image cache stays off.';
      return;
    }
    onChange((draft) => (draft.images.enabled = true));
  }

  onMount(() => {
    void reload();
    return revokeAll;
  });

  // Focus lands on the close button, so Escape and Enter both leave the viewer.
  $effect(() => {
    if (selected !== null) closeButton?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (event.key === 'Escape' && selected !== null) close();
  }
</script>

<svelte:window onkeydown={onKeydown} />

<section id="gallery" class="scroll-mt-20 border-t border-line pt-5">
  <h2 class="text-[15px] font-semibold text-ink">Gallery</h2>
  <p class="mt-1 text-[12px] text-dim">
    Every image the cache is holding for a sleeping tab, newest first. The bytes sit in this browser's storage for
    TabDorm, never on a server.
  </p>

  <div class="mt-3">
    {#if error !== ''}
      <div class="flex items-start gap-2 rounded-lg border border-bad/40 bg-bad/10 px-3 py-2 text-[12px] text-bad" role="alert">
        <Icon name="alert" size={13} class="mt-0.5 shrink-0" />
        <p class="min-w-0 flex-1 break-words">{error}</p>
        <button
          type="button"
          class="shrink-0 rounded-md px-2 py-0.5 text-[12px] text-ink transition-colors duration-120 hover:bg-raised"
          onclick={() => void reload()}>Try again</button
        >
      </div>
    {:else if loading && cards.length === 0}
      <div class="grid grid-cols-2 gap-2 min-[520px]:grid-cols-3 min-[760px]:grid-cols-4" aria-hidden="true">
        {#each SKELETONS as cell (cell)}
          <div class="aspect-[4/3] rounded-lg border border-line bg-raised"></div>
        {/each}
      </div>
      <p class="mt-2 text-[12px] text-faint">Reading the cache…</p>
    {:else if cards.length === 0}
      <div class="rounded-lg border border-line bg-raised px-4 py-6 text-center">
        <Icon name="camera" size={20} class="mx-auto text-faint" />
        {#if config.images.enabled}
          <p class="mt-2 text-[13px] text-ink">Nothing cached yet</p>
          <p class="mt-1 text-[12px] text-dim">
            Pictures are saved when a tab falls asleep. Suspend one, then press Refresh.
          </p>
        {:else}
          <p class="mt-2 text-[13px] text-ink">Image cache is off</p>
          <p class="mt-1 text-[12px] text-dim">
            TabDorm keeps nothing until you switch it on. Reading a page's pictures needs a one-time permission.
          </p>
          <button
            type="button"
            class="mt-3 rounded-md bg-awake px-3 py-1.5 text-[12px] font-semibold text-on-awake transition-colors duration-120 hover:bg-accent-strong"
            onclick={() => void enableCache()}>Turn on the image cache</button
          >
        {/if}
        {#if permissionNote !== ''}
          <p class="mt-2 text-[12px] text-bad" role="alert">{permissionNote}</p>
        {/if}
      </div>
    {:else}
      <div class="grid grid-cols-2 gap-2 min-[520px]:grid-cols-3 min-[760px]:grid-cols-4">
        {#each cards as card (card.key)}
          <button
            type="button"
            class="group overflow-hidden rounded-lg border border-line bg-raised text-left transition-colors duration-120 hover:border-accent/60"
            aria-label="Inspect the cached image from {card.host}"
            onclick={() => (selected = card)}
          >
            <span class="block aspect-[4/3] overflow-hidden bg-overlay">
              <img
                src={card.url}
                alt="Cached image from {card.host}"
                loading="lazy"
                decoding="async"
                class="h-full w-full object-cover transition-transform duration-150 group-hover:scale-[1.02]"
              />
            </span>
            <span class="block px-2 py-1.5">
              <span class="block truncate text-[12px] text-ink" title={card.pageUrl}>{card.host}</span>
              <span class="block truncate text-[11px] text-faint">{formatByteSize(card.size)} · {formatDay(card.savedAt)}</span>
            </span>
          </button>
        {/each}
      </div>

      <div class="mt-3 flex items-center gap-2 text-[12px] text-dim">
        <span class="min-w-0 flex-1">{cards.length} of {total} · {formatByteSize(bytes)} stored</span>
        <button
          type="button"
          class="rounded-md px-2 py-1 text-ink transition-colors duration-120 hover:bg-raised disabled:opacity-40"
          disabled={loading || cards.length >= total}
          onclick={() => void loadMore()}>{loading ? 'Loading…' : 'Load more'}</button
        >
        <button
          type="button"
          class="rounded-md px-2 py-1 text-dim transition-colors duration-120 hover:bg-raised hover:text-ink"
          disabled={loading}
          onclick={() => void reload()}>Refresh</button
        >
      </div>
    {/if}
  </div>

  {#if selected !== null}
    <div class="fixed inset-0 z-50 grid place-items-center bg-surface/85 p-4" role="dialog" aria-modal="true" aria-label="Cached image">
      <div class="w-full max-w-[640px] overflow-hidden rounded-xl border border-line bg-overlay">
        <div class="flex items-center gap-2 border-b border-line px-3 py-2">
          <span class="min-w-0 flex-1 truncate text-[13px] text-ink">{selected.host}</span>
          <button
            bind:this={closeButton}
            type="button"
            class="rounded-md p-1 text-dim transition-colors duration-120 hover:bg-raised hover:text-ink"
            aria-label="Close the image viewer"
            onclick={close}
          >
            <Icon name="close" size={14} />
          </button>
        </div>

        <div class="bg-surface p-3">
          <img
            src={selected.url}
            alt="Cached image from {selected.host}"
            class="mx-auto block max-h-[60vh] w-auto max-w-full rounded-md object-contain"
          />
        </div>

        <dl class="divide-y divide-line/60 px-3 pb-1 text-[12px]">
          <div class="flex items-baseline gap-3 py-1.5">
            <dt class="w-24 shrink-0 text-faint">Size</dt>
            <dd class="min-w-0 flex-1 text-dim">{formatByteSize(selected.size)}</dd>
          </div>
          <div class="flex items-baseline gap-3 py-1.5">
            <dt class="w-24 shrink-0 text-faint">Saved</dt>
            <dd class="min-w-0 flex-1 text-dim">{formatSaved(selected.savedAt)}</dd>
          </div>
          <div class="flex items-baseline gap-3 py-1.5">
            <dt class="w-24 shrink-0 text-faint">From page</dt>
            <dd class="min-w-0 flex-1">
              <a
                href={selected.pageUrl}
                target="_blank"
                rel="noreferrer noopener"
                class="text-accent underline-offset-2 hover:underline"
                title={selected.pageUrl}>{selected.host}</a
              >
            </dd>
          </div>
          <div class="flex items-baseline gap-3 py-1.5">
            <dt class="w-24 shrink-0 text-faint">Image URL</dt>
            <dd class="min-w-0 flex-1 break-all font-mono text-[11px] text-dim">{selected.key}</dd>
          </div>
        </dl>
      </div>
    </div>
  {/if}
</section>
