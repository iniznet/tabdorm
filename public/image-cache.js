(() => {
  if (window.__tabdormImageCache) return;
  window.__tabdormImageCache = true;

  const MAX_KEYS = 60;
  const MAX_APPLY = 40;
  const SCHEDULE_MS = 60;

  // Announce band: what this page shows, told to the worker as it loads, so a
  // later suspend has nothing left to fetch. Bounded per page: a gallery can
  // hold hundreds of pictures and every candidate costs the worker one read.
  const ANNOUNCE_MS = 400;
  const MAX_ANNOUNCE = 120;
  const ANNOUNCE_BATCH = 40;
  const announced = new Set();
  let announceQueue = [];
  let announceTimer;

  const pending = new Set();
  const requested = new Set();
  let scheduled = false;
  let dataImagesAllowed = true;

  // A strict img-src CSP can refuse the substitute. One probe decides whether
  // background swaps are worth attempting; <img> swaps self-heal on error.
  const probe = new Image();
  probe.addEventListener('error', () => { dataImagesAllowed = false; });
  probe.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';

  const normalize = (raw) => {
    try {
      const url = new URL(raw, location.href);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hash = '';
      return url.toString();
    } catch {
      return null;
    }
  };

  const boxPixels = (element) => {
    const box = element.getBoundingClientRect();
    return Math.round(box.width) * Math.round(box.height);
  };

  /** One candidate for the worker, at most once per page. */
  const announce = (raw, pixels, kind) => {
    const key = normalize(raw);
    if (key === null || announced.has(key)) return;
    if (announced.size >= MAX_ANNOUNCE) return;
    announced.add(key);
    announceQueue.push({ src: key, pixels, kind });
    if (announceTimer === undefined) announceTimer = setTimeout(flushAnnounce, ANNOUNCE_MS);
  };

  const flushAnnounce = async () => {
    announceTimer = undefined;
    if (announceQueue.length === 0) return;
    const items = announceQueue.slice(0, ANNOUNCE_BATCH);
    announceQueue = announceQueue.slice(items.length);
    try {
      await chrome.runtime.sendMessage({ type: 'imageCandidates', pageUrl: location.href, items });
    } catch {
      // Worker restarting or extension reloading: the next batch carries on.
    }
    if (announceQueue.length > 0 && announceTimer === undefined) {
      announceTimer = setTimeout(flushAnnounce, ANNOUNCE_MS);
    }
  };

  const scan = () => {
    for (const image of document.images) {
      const raw = image.currentSrc || image.getAttribute('src') || '';
      const natural = image.naturalWidth * image.naturalHeight;
      announce(raw, natural > 0 ? natural : boxPixels(image), 'img');
      if (image.dataset.tabdormCached === '1') continue;
      const key = normalize(raw);
      if (key !== null && !requested.has(key)) pending.add(key);
    }
    const pattern = /^url\(\s*["']?([^"')]+)["']?\s*\)/;
    for (const element of document.querySelectorAll('body *')) {
      if (element.dataset.tabdormCachedBackground === '1') continue;
      if (boxPixels(element) <= 0) continue;
      const computed = getComputedStyle(element).backgroundImage;
      if (computed === 'none' || computed === '') continue;
      const match = pattern.exec(computed);
      if (match === null) continue;
      announce(match[1], boxPixels(element), 'img');
      const key = normalize(match[1]);
      if (key !== null && !requested.has(key)) pending.add(key);
    }
  };

  /**
   * Pictures a viewer downloads itself and paints by script never appear as an
   * <img> once replaced, so resource timing names them. No rendered box exists
   * here, which is why the worker falls back to a byte floor for these.
   */
  const observeTransfers = () => {
    if (typeof PerformanceObserver !== 'function') return;
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          if (entry.initiatorType !== 'fetch' && entry.initiatorType !== 'xmlhttprequest') continue;
          announce(entry.name, 0, 'fetch');
        }
      });
      observer.observe({ type: 'resource', buffered: true });
    } catch {
      // No resource timing on this page: the <img> pass still runs.
    }
  };

  const swapImage = (image, dataUrl) => {
    const original = image.getAttribute('src') ?? '';
    image.dataset.tabdormCached = '1';
    image.dataset.tabdormOriginal = original;
    image.addEventListener('error', () => {
      if (image.dataset.tabdormCached !== '1') return;
      delete image.dataset.tabdormCached;
      image.setAttribute('src', original);
    }, { once: true });
    image.setAttribute('src', dataUrl);
  };

  const swapBackground = (element, dataUrl) => {
    element.dataset.tabdormCachedBackground = '1';
    element.style.backgroundImage = 'url("' + dataUrl + '")';
  };

  const apply = (images) => {
    const applied = new Set();
    for (const [key, dataUrl] of Object.entries(images)) {
      if (applied.size >= MAX_APPLY) break;
      if (typeof dataUrl !== 'string' || !dataUrl.startsWith('data:image/')) continue;

      for (const image of document.images) {
        if (applied.has(key)) break;
        if (image.dataset.tabdormCached === '1') continue;
        if (image.complete && image.naturalWidth > 0) continue;
        if (normalize(image.currentSrc || image.getAttribute('src') || '') !== key) continue;
        swapImage(image, dataUrl);
        applied.add(key);
      }
      if (applied.has(key) || !dataImagesAllowed) continue;

      const pattern = /^url\(\s*["']?([^"')]+)["']?\s*\)/;
      for (const element of document.querySelectorAll('body *')) {
        if (applied.has(key)) break;
        if (element.dataset.tabdormCachedBackground === '1') continue;
        if (element.dataset.tabdormCached === '1') continue;
        if (element.tagName === 'IMG') continue;
        if (boxPixels(element) <= 0) continue;
        const computed = getComputedStyle(element).backgroundImage;
        const match = pattern.exec(computed);
        if (match === null || normalize(match[1]) !== key) continue;
        swapBackground(element, dataUrl);
        applied.add(key);
      }
    }
  };

  const flush = async () => {
    if (pending.size === 0) return;
    const keys = [...pending].slice(0, MAX_KEYS);
    for (const key of keys) {
      pending.delete(key);
      requested.add(key);
    }
    let response;
    try {
      response = await chrome.runtime.sendMessage({ type: 'imagesLookup', pageUrl: location.href, keys });
    } catch {
      // Extension reloading or no worker: leave the page alone.
      return;
    }
    if (response === undefined || response === null || response.ok !== true) return;
    const payload = response.payload;
    if (payload === undefined || payload === null || typeof payload.images !== 'object') return;
    apply(payload.images);
  };

  const schedule = () => {
    if (scheduled) return;
    scheduled = true;
    setTimeout(() => {
      scheduled = false;
      scan();
      void flush();
    }, SCHEDULE_MS);
  };

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', schedule, { once: true });
  } else {
    schedule();
  }
  observeTransfers();
  new MutationObserver(schedule).observe(document.documentElement, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['src', 'style'],
  });
})();
