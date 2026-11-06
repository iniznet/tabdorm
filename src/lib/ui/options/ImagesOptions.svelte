<script lang="ts">
  import Toggle from '@/lib/ui/controls/Toggle.svelte';
  import NumberField from '@/lib/ui/controls/NumberField.svelte';
  import Icon from '@/lib/ui/Icon.svelte';
  import { sendToBackground } from '@/core/messaging';
  import { formatByteSize } from '@/core/image-cache';
  import type { ImageHostStat, TabDormConfig } from '@/types';

  interface Props {
    config: TabDormConfig;
    onChange: (mutate: (draft: TabDormConfig) => void) => void;
  }

  let { config, onChange }: Props = $props();

  let note = $state('');
  let count = $state(0);
  let bytes = $state(0);
  let hosts = $state<ImageHostStat[]>([]);
  let busy = $state(false);

  async function refresh(): Promise<void> {
    const response = await sendToBackground({ type: 'imagesStats' });
    if (!response.ok) {
      note = response.error;
      return;
    }
    const payload = response.payload as
      | { totals?: { count?: number; bytes?: number }; hosts?: ImageHostStat[] }
      | undefined;
    count = payload?.totals?.count ?? 0;
    bytes = payload?.totals?.bytes ?? 0;
    hosts = payload?.hosts ?? [];
  }

  $effect(() => {
    void refresh();
  });

  /**
   * Capturing reads the page DOM before a discard, which needs the optional broad
   * grant. Never switch the knob on behind an ungranted permission.
   */
  async function toggleEnabled(next: boolean): Promise<void> {
    note = '';
    if (!next) {
      onChange((draft) => (draft.images.enabled = false));
      return;
    }
    const granted = await chrome.permissions.request({ permissions: ['scripting'], origins: ['<all_urls>'] });
    if (!granted) {
      note = 'Permission not granted, so the image cache stays off.';
      return;
    }
    onChange((draft) => (draft.images.enabled = true));
  }

  async function clearAll(): Promise<void> {
    busy = true;
    const response = await sendToBackground({ type: 'imagesClearAll' });
    if (response.ok) {
      const payload = response.payload as { removed?: number; bytes?: number } | undefined;
      note = `Cleared ${payload?.removed ?? 0} image(s), ${formatByteSize(payload?.bytes ?? 0)}.`;
    } else {
      note = response.error;
    }
    busy = false;
    await refresh();
  }

  async function clearHost(host: string): Promise<void> {
    busy = true;
    const response = await sendToBackground({ type: 'imagesClearHost', host });
    if (response.ok) {
      const payload = response.payload as { removed?: number; bytes?: number } | undefined;
      note = `Cleared ${payload?.removed ?? 0} image(s) for ${host}, ${formatByteSize(payload?.bytes ?? 0)}.`;
    } else {
      note = response.error;
    }
    busy = false;
    await refresh();
  }
</script>

<section id="images" class="scroll-mt-20 border-t border-line pt-5">
  <h2 class="text-[15px] font-semibold text-ink">Images</h2>
  <p class="mt-1 text-[12px] text-dim">
    TabDorm can keep the images a tab is showing when it falls asleep, so waking it paints them from local storage instead of
    waiting on the network. Entries expire on a timer and the whole store stays inside a byte budget.
  </p>

  <div class="mt-3 divide-y divide-line/70">
    <Toggle
      checked={config.images.enabled}
      label="Keep images of sleeping tabs"
      hint="Off by default. Turning it on asks for the optional broad site permission, because the images have to be read from the page before it sleeps."
      onChange={(value) => void toggleEnabled(value)}
    />
    <NumberField
      value={config.images.ttlMinutes}
      label="Keep each image for"
      hint="Measured from the moment the tab falls asleep. 1440 = one day, 10080 = one week."
      min={15}
      max={20160}
      suffix="minutes"
      onChange={(value) => onChange((draft) => (draft.images.ttlMinutes = value))}
    />
    <NumberField
      value={config.images.maxMegabytes}
      label="Storage budget"
      hint="The least recently seen images go first once the store grows past this."
      min={8}
      max={1024}
      suffix="MB"
      onChange={(value) => onChange((draft) => (draft.images.maxMegabytes = value))}
    />
    <NumberField
      value={config.images.maxImageKilobytes}
      label="Skip images larger than"
      hint="One hero banner can cost more than a page of thumbnails."
      min={32}
      max={8192}
      suffix="KB"
      onChange={(value) => onChange((draft) => (draft.images.maxImageKilobytes = value))}
    />
    <NumberField
      value={config.images.minPixels}
      label="Skip images smaller than"
      hint="Pixel area. 4096 is a 64 by 64 icon, so tracking pixels and spacers never earn a record."
      min={0}
      max={250000}
      suffix="px²"
      onChange={(value) => onChange((draft) => (draft.images.minPixels = value))}
    />
    <NumberField
      value={config.images.captureDeadlineMs}
      label="Capture time limit per tab"
      hint="A slow page gives up here, so a suspend never waits on the network. 1500 = 1.5 seconds."
      min={250}
      max={5000}
      suffix="ms"
      onChange={(value) => onChange((draft) => (draft.images.captureDeadlineMs = value))}
    />
  </div>

  <div class="mt-4 rounded-md border border-line bg-raised px-3 py-2.5">
    <div class="flex items-baseline gap-2">
      <span class="text-[13px] text-ink">Stored now</span>
      <span class="text-[12px] text-dim">{count} image(s), {formatByteSize(bytes)}</span>
      <button
        type="button"
        class="ml-auto rounded-md px-2 py-1 text-[12px] text-bad transition-colors duration-120 hover:bg-bad/10 disabled:opacity-40"
        disabled={busy || count === 0}
        onclick={() => void clearAll()}>Clear all cached images</button
      >
    </div>

    {#if hosts.length > 0}
      <ul class="mt-2 divide-y divide-line/60">
        {#each hosts.slice(0, 8) as host (host.host)}
          <li class="flex items-center gap-2 py-1.5 text-[12px]">
            <span class="min-w-0 flex-1 truncate text-dim" title={host.host}>{host.host}</span>
            <span class="shrink-0 text-faint">{host.count} · {formatByteSize(host.bytes)}</span>
            <button
              type="button"
              class="shrink-0 rounded-md px-1.5 py-0.5 text-[11px] text-dim transition-colors duration-120 hover:bg-overlay hover:text-ink disabled:opacity-40"
              aria-label={`Clear cached images for ${host.host}`}
              disabled={busy}
              onclick={() => void clearHost(host.host)}>Clear</button
            >
          </li>
        {/each}
      </ul>
      {#if hosts.length > 8}
        <p class="mt-1 text-[11px] text-faint">and {hosts.length - 8} more site(s), included in Clear all.</p>
      {/if}
    {/if}

    {#if note !== ''}
      <p class="mt-2 flex items-start gap-1.5 text-[12px] text-dim" role="status">
        <Icon name="check" size={12} class="mt-0.5 shrink-0" />
        <span class="min-w-0 flex-1 break-words">{note}</span>
      </p>
    {/if}
  </div>
</section>
