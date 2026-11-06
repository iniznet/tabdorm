<script lang="ts">
  import { onMount } from 'svelte';
  import Icon from '@/lib/ui/Icon.svelte';
  import { formatByteSize, nextGalleryWindow } from '@/core/image-cache';
  import { imageGalleryCount, imageGalleryPage, imageTotals, sessionTotals } from '@/core/image-store';
  import type { GalleryImage, TabDormConfig } from '@/types';

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
    /** Small preview the tile paints. */
    preview: string;
    /** Original bytes, kept un-decoded until the reader presses the tile. */
    blob: Blob;
    /** Which band the row came from: a live tab's copy, or a sleeping one's. */
    origin: 'session' | 'offline';
  }

  let cards = $state<Card[]>([]);
  let total = $state(0);
  let bytes = $state(0);
  let loading = $state(true);
  let error = $state('');
  let selectedIndex = $state(-1);
  let selectedUrl = $state('');
  /** The opened card, derived from the index so stepping never forks state. */
  const selected = $derived(selectedIndex >= 0 ? (cards[selectedIndex] ?? null) : null);
  let closeButton = $state<HTMLButtonElement | null>(null);
  let permissionNote = $state('');

  /** Live object URLs, revoked on refresh and on teardown so no blob is pinned. */
  const liveUrls = new Set<string>();

  function revokeAll(): void {
    for (const url of liveUrls) URL.revokeObjectURL(url);
    liveUrls.clear();
  }

  function toCard(row: GalleryImage): Card {
    // Records from before previews, and images already small, paint the original.
    const preview = URL.createObjectURL(row.preview ?? row.blob);
    liveUrls.add(preview);
    return {
      key: row.key,
      host: row.host,
      pageUrl: row.pageUrl,
      size: row.size,
      savedAt: row.savedAt,
      preview,
      blob: row.blob,
      origin: row.origin,
    };
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
      const [allCount, totals, live] = await Promise.all([imageGalleryCount(), imageTotals(), sessionTotals()]);
      total = allCount;
      bytes = totals.bytes + live.bytes;
      await loadMore();
    } catch (cause) {
      error = cause instanceof Error ? cause.message : 'The cache could not be read.';
      loading = false;
    }
  }

  function close(): void {
    if (selectedUrl !== '') URL.revokeObjectURL(selectedUrl);
    selectedUrl = '';
    selectedIndex = -1;
  }

  /** Full-size url is minted here, so nothing decodes until a tile is pressed. */
  function openAt(index: number): void {
    const card = cards[index];
    if (card === undefined) return;
    if (selectedUrl !== '') URL.revokeObjectURL(selectedUrl);
    selectedUrl = URL.createObjectURL(card.blob);
    selectedIndex = index;
  }

  function step(delta: number): void {
    const next = selectedIndex + delta;
    if (next < 0 || next >= cards.length) return;
    openAt(next);
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
    if (selectedIndex >= 0) closeButton?.focus();
  });

  function onKeydown(event: KeyboardEvent): void {
    if (selectedIndex < 0) return;
    if (event.key === 'Escape') {
      close();
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      step(1);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      step(-1);
    }
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
        {#each cards as card, index (card.key)}
          <button
            type="button"
            class="group overflow-hidden rounded-lg border border-line bg-raised text-left transition-colors duration-120 hover:border-accent/60"
            aria-label="Inspect the cached image from {card.host}"
            onclick={() => openAt(index)}
          >
            <span class="block aspect-[4/3] overflow-hidden bg-overlay">
              <img
                src={card.preview}
                alt="Cached image from {card.host}"
                loading="lazy"
                decoding="async"
                class="h-full w-full object-contain transition-transform duration-150 group-hover:scale-[1.02]"
              />
            </span>
            <span class="block px-2 py-1.5">
              <span class="block truncate text-[12px] text-ink" title={card.pageUrl}>{card.host}</span>
              <span class="block truncate text-[11px] text-faint">
                {formatByteSize(card.size)} · {formatDay(card.savedAt)}{card.origin === 'session' ? ' · live tab' : ''}
              </span>
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
    <div
      class="fixed inset-0 z-50 flex flex-col bg-surface/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Cached image viewer"
    >
      <header class="flex items-center gap-2 border-b border-line px-3 py-2">
        <span class="shrink-0 rounded-md bg-raised px-1.5 py-0.5 font-mono text-[11px] text-dim">
          {selectedIndex + 1} / {cards.length}
        </span>
        <span class="min-w-0 flex-1 truncate text-[13px] text-ink" title={selected.pageUrl}>{selected.host}</span>
        <span class="hidden shrink-0 text-[11px] text-faint min-[520px]:inline">← → to walk · Esc to close</span>
        <button
          bind:this={closeButton}
          type="button"
          class="shrink-0 rounded-md p-1 text-dim transition-colors duration-120 hover:bg-raised hover:text-ink"
          aria-label="Close the image viewer"
          onclick={close}
        >
          <Icon name="close" size={14} />
        </button>
      </header>

      <div class="relative flex min-h-0 flex-1 items-center justify-center p-2">
        <button
          type="button"
          class="absolute left-2 z-10 grid h-9 w-9 place-items-center rounded-full border border-line bg-raised/90 text-ink transition-colors duration-120 hover:bg-overlay disabled:opacity-30"
          aria-label="Previous image"
          disabled={selectedIndex === 0}
          onclick={() => step(-1)}
        >
          <Icon name="chevron" size={16} class="rotate-180" />
        </button>

        <img
          src={selectedUrl}
          alt="Cached image from {selected.host}"
          decoding="async"
          class="max-h-full max-w-full rounded-md object-contain"
        />

        <button
          type="button"
          class="absolute right-2 z-10 grid h-9 w-9 place-items-center rounded-full border border-line bg-raised/90 text-ink transition-colors duration-120 hover:bg-overlay disabled:opacity-30"
          aria-label="Next image"
          disabled={selectedIndex === cards.length - 1}
          onclick={() => step(1)}
        >
          <Icon name="chevron" size={16} />
        </button>
      </div>

      <footer class="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-3 py-2 text-[12px] text-dim">
        <span class="shrink-0">{formatByteSize(selected.size)}</span>
        <span class="shrink-0">Saved {formatSaved(selected.savedAt)}</span>
        <a
          href={selected.pageUrl}
          target="_blank"
          rel="noreferrer noopener"
          class="shrink-0 text-accent underline-offset-2 hover:underline"
          title={selected.pageUrl}>{selected.host}</a
        >
        <span class="min-w-0 flex-1 truncate font-mono text-[11px] text-faint" title={selected.key}>{selected.key}</span>
      </footer>
    </div>
  {/if}
</section>
