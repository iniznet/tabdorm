<script lang="ts">
  /**
   * Authored icon set — 16px grid, 1.5 stroke, round caps, currentColor.
   * Emoji are banned as icons; every glyph in the product comes from here.
   */
  type IconName =
    | 'moon'
    | 'sun'
    | 'pin'
    | 'speaker'
    | 'clock'
    | 'camera'
    | 'close'
    | 'search'
    | 'chevron'
    | 'trash'
    | 'plus'
    | 'check'
    | 'alert'
    | 'external'
    | 'download'
    | 'upload'
    | 'refresh'
    | 'layers'
    | 'shield'
    | 'copy'
    | 'arrow-left'
    | 'sliders'
    | 'dots'
    | 'spark';

  let { name, size = 16, class: className = '' }: { name: IconName; size?: number; class?: string } = $props();

  const paths: Record<IconName, string> = {
    moon: 'M13.5 9.4A5.6 5.6 0 0 1 6.6 2.5a5.6 5.6 0 1 0 6.9 6.9Z',
    sun: 'M8 11.2a3.2 3.2 0 1 0 0-6.4 3.2 3.2 0 0 0 0 6.4ZM8 1.5v1.6M8 12.9v1.6M1.5 8h1.6M12.9 8h1.6M3.4 3.4l1.1 1.1M11.5 11.5l1.1 1.1M12.6 3.4l-1.1 1.1M4.5 11.5l-1.1 1.1',
    pin: 'M6.2 2.4h3.6l-.5 3.2 2.4 2.4H4.3l2.4-2.4-.5-3.2ZM8 8v5.6',
    speaker: 'M3.2 6.2h2.1L8.8 3.5v9L5.3 9.8H3.2a1 1 0 0 1-1-1V7.2a1 1 0 0 1 1-1ZM11.4 6a2.8 2.8 0 0 1 0 4',
    clock: 'M8 14.2A6.2 6.2 0 1 0 8 1.8a6.2 6.2 0 0 0 0 12.4ZM8 4.6V8l2.4 1.6',
    camera: 'M2.4 5.6h2l1-1.6h5.2l1 1.6h2v7.2H2.4V5.6ZM8 11.2a2.4 2.4 0 1 0 0-4.8 2.4 2.4 0 0 0 0 4.8Z',
    close: 'M4 4l8 8M12 4l-8 8',
    search: 'M7.2 12.4a5.2 5.2 0 1 0 0-10.4 5.2 5.2 0 0 0 0 10.4ZM11.2 11.2l3.2 3.2',
    chevron: 'M6 3.6 10.4 8 6 12.4',
    trash: 'M3 5.2h10M6.2 5.2V3.6h3.6v1.6M4.4 5.2l.6 8.2h6l.6-8.2M6.8 7.4v4M9.2 7.4v4',
    plus: 'M8 3.2v9.6M3.2 8h9.6',
    check: 'M3 8.4l3.2 3.2L13 4.4',
    alert: 'M8 2.6 14.2 13H1.8L8 2.6ZM8 6.6v3.2M8 11.4v.6',
    external: 'M9.6 2.8h3.6v3.6M13.2 2.8 7.4 8.6M11.6 9.4v3.8H2.8V4.4h3.8',
    download: 'M8 2.6v7.2M4.8 6.8 8 10l3.2-3.2M2.8 12.6h10.4',
    upload: 'M8 10.2V3M4.8 6 8 2.8 11.2 6M2.8 12.6h10.4',
    refresh: 'M13 8a5 5 0 1 1-1.6-3.7M13 2.6v3h-3',
    layers: 'M8 2.4 2.6 5.2 8 8l5.4-2.8L8 2.4ZM2.6 8 8 10.8 13.4 8M2.6 10.8 8 13.6l5.4-2.8',
    shield: 'M8 2.4 3.2 4v3.6c0 3 2 5 4.8 6 2.8-1 4.8-3 4.8-6V4L8 2.4Z',
    copy: 'M5.6 5.6h7.2v7.6H5.6V5.6ZM3.2 10.4V2.8h7.2',
    'arrow-left': 'M12.4 8H3.6M7.2 3.6 2.8 8l4.4 4.4',
    spark: 'M8 2.4v4.4M8 9.2v4.4M2.4 8h4.4M9.2 8h4.4',
    dots: 'M3.2 8h.02M8 8h.02M12.8 8h.02',
    sliders: 'M2.6 5.2h5.2M10.4 5.2h3M2.6 10.8h3M8.2 10.8h5.2M9.2 3.4v3.6M6.1 9v3.6',
  };
</script>

<svg
  width={size}
  height={size}
  viewBox="0 0 16 16"
  fill="none"
  stroke="currentColor"
  stroke-width="1.5"
  stroke-linecap="round"
  stroke-linejoin="round"
  class={className}
  aria-hidden="true"
  focusable="false"
>
  <path d={paths[name]} />
</svg>
