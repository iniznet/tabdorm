import assert from 'node:assert/strict';
import test from 'node:test';
import {
  blobImageKey,
  exceedsByteCeiling,
  fitWithin,
  formatByteSize,
  hostOfUrl,
  isCacheableImageUrl,
  nextGalleryWindow,
  selectCaptureCandidates,
  normalizeImageKey,
  pickPageThumbs,
  selectExpired,
  selectOverBudget,
  ttlMsOf,
} from '../src/core/image-cache.ts';
import type { ImageCacheConfig } from '../src/types/config.ts';

const config = (overrides: Partial<ImageCacheConfig> = {}): ImageCacheConfig => ({
  enabled: true,
  ttlMinutes: 1_440,
  maxMegabytes: 64,
  maxImageKilobytes: 512,
  minPixels: 4_096,
  captureDeadlineMs: 1_500,
  ...overrides,
});

const PAGE = 'https://news.example.com/story/1';

test('a cache key is the absolute URL with the fragment dropped', () => {
  assert.equal(normalizeImageKey('/img/hero.png#frag', PAGE), 'https://news.example.com/img/hero.png');
  assert.equal(
    normalizeImageKey('../media/a.jpg?w=800&sig=abc', PAGE),
    'https://news.example.com/media/a.jpg?w=800&sig=abc',
  );
});

test('only http and https earn a cache key', () => {
  for (const raw of [
    'data:image/png;base64,AAAA',
    'blob:https://news.example.com/1234',
    'javascript:alert(1)',
    'chrome-extension://abc/icon.png',
    'http://',
  ]) {
    assert.equal(normalizeImageKey(raw, PAGE), null, raw);
  }
});

test('hostOfUrl keeps the port and refuses non-http schemes', () => {
  assert.equal(hostOfUrl('https://cdn.example.com:8443/a.png'), 'cdn.example.com:8443');
  assert.equal(hostOfUrl('data:image/png;base64,AAAA'), null);
  assert.equal(hostOfUrl('garbage'), null);
});

test('the pixel floor rejects tracking pixels and unmeasured images', () => {
  assert.equal(isCacheableImageUrl('https://cdn.example.com/beacon.gif', PAGE, 1, config()), false);
  assert.equal(isCacheableImageUrl('https://cdn.example.com/hero.png', PAGE, 0, config()), false);
  assert.equal(isCacheableImageUrl('https://cdn.example.com/hero.png', PAGE, 4_096, config()), true);
  assert.equal(isCacheableImageUrl('/local.png', PAGE, 200 * 200, config()), true);
});

test('the pixel floor is configurable down to zero', () => {
  assert.equal(isCacheableImageUrl('https://cdn.example.com/tiny.png', PAGE, 1, config({ minPixels: 0 })), true);
});

test('the byte ceiling refuses empty bodies and oversized images', () => {
  assert.equal(exceedsByteCeiling(0, config()), true);
  assert.equal(exceedsByteCeiling(Number.NaN, config()), true);
  assert.equal(exceedsByteCeiling(512 * 1024, config()), false);
  assert.equal(exceedsByteCeiling(512 * 1024 + 1, config()), true);
  // Zero is no ceiling: a 40 MB picture is kept, and an empty body still is not.
  const uncapped = config({ maxImageKilobytes: 0 });
  assert.equal(exceedsByteCeiling(40 * 1024 * 1024, uncapped), false);
  assert.equal(exceedsByteCeiling(0, uncapped), true);
  assert.equal(exceedsByteCeiling(900 * 1024, config({ maxImageKilobytes: 1_024 })), false);
});

test('a zero budget disables eviction instead of dropping everything', () => {
  const rows = [
    { key: 'a', size: 900, savedAt: 1, lastUsed: 1 },
    { key: 'b', size: 900, savedAt: 1, lastUsed: 2 },
  ];
  assert.deepEqual(selectOverBudget(rows, 0), []);
  assert.deepEqual(selectOverBudget(rows, -1), []);
  assert.deepEqual(selectOverBudget(rows, 1_800), []);
  assert.deepEqual(selectOverBudget(rows, 1_799), ['a']);
});

test('formatByteSize stays readable across the three magnitudes', () => {
  assert.equal(formatByteSize(0), '0 B');
  assert.equal(formatByteSize(-5), '0 B');
  assert.equal(formatByteSize(940), '940 B');
  assert.equal(formatByteSize(12_697), '12.4 KB');
  assert.equal(formatByteSize(1_887_437), '1.8 MB');
});

test('ttlMsOf converts minutes to milliseconds', () => {
  assert.equal(ttlMsOf(config()), 86_400_000);
  assert.equal(ttlMsOf(config({ ttlMinutes: 15 })), 900_000);
});

test('selectExpired keeps what is young and drops what is exactly expired', () => {
  const now = 1_000_000_000;
  const ttl = ttlMsOf(config());
  const records = [
    { key: 'fresh', size: 10, savedAt: now - 1, lastUsed: now },
    { key: 'edge', size: 10, savedAt: now - ttl, lastUsed: now },
    { key: 'stale', size: 10, savedAt: now - ttl - 1, lastUsed: now },
  ];
  assert.deepEqual(selectExpired(records, now, ttl), ['edge', 'stale']);
});

test('selectOverBudget leaves a store under budget alone', () => {
  const records = [
    { key: 'a', size: 10, savedAt: 1, lastUsed: 5 },
    { key: 'b', size: 10, savedAt: 1, lastUsed: 6 },
  ];
  assert.deepEqual(selectOverBudget(records, 20), []);
  assert.deepEqual(selectOverBudget(records, 1_000), []);
});

test('selectOverBudget drops the least recently used first until the budget fits', () => {
  const records = [
    { key: 'oldest', size: 40, savedAt: 1, lastUsed: 10 },
    { key: 'middle', size: 40, savedAt: 1, lastUsed: 20 },
    { key: 'newest', size: 40, savedAt: 1, lastUsed: 30 },
  ];
  assert.deepEqual(selectOverBudget(records, 100), ['oldest']);
  assert.deepEqual(selectOverBudget(records, 60), ['oldest', 'middle']);
  assert.deepEqual(selectOverBudget(records, 1), ['oldest', 'middle', 'newest']);
});

test('selectOverBudget breaks a lastUsed tie by key so the order is total', () => {
  const records = [
    { key: 'b', size: 10, savedAt: 1, lastUsed: 7 },
    { key: 'a', size: 10, savedAt: 1, lastUsed: 7 },
    { key: 'c', size: 10, savedAt: 1, lastUsed: 7 },
  ];
  assert.deepEqual(selectOverBudget(records, 10), ['a', 'b']);
  assert.deepEqual(selectOverBudget(records, 20), ['a']);
});

test('gallery pages walk a stable store without repeating a key', () => {
  assert.deepEqual(nextGalleryWindow(55, 0, 24), { offset: 0, limit: 24 });
  assert.deepEqual(nextGalleryWindow(55, 24, 24), { offset: 24, limit: 24 });
  assert.deepEqual(nextGalleryWindow(55, 48, 24), { offset: 48, limit: 7 });
});

test('blob keys sit outside the url space, so replay can never match one', () => {
  const key = blobImageKey('9bce47fd4324d9a9');
  assert.equal(key, 'blob-sha256:9bce47fd4324d9a9');
  // Not an http(s) url: the replay script matches page urls and skips this record.
  assert.equal(normalizeImageKey(key, 'https://e-hentai.org/s/1'), null);
  assert.notEqual(blobImageKey('0000000000000000'), key);
});

test('capture keeps the biggest candidates, not the first ones', () => {
  const page = [
    { src: 'avatar', pixels: 900 },
    { src: 'hero', pixels: 1_200_000 },
    { src: 'icon', pixels: 256 },
    { src: 'figure', pixels: 40_000 },
    { src: 'sprite', pixels: 4_096 },
  ];
  assert.deepEqual(
    selectCaptureCandidates(page, 3).map((candidate) => candidate.src),
    ['hero', 'figure', 'sprite'],
  );
});

test('capture keeps page order inside a tie, so two runs agree', () => {
  const page = [
    { src: 'first', pixels: 10_000 },
    { src: 'second', pixels: 10_000 },
    { src: 'third', pixels: 10_000 },
  ];
  assert.deepEqual(
    selectCaptureCandidates(page, 2).map((candidate) => candidate.src),
    ['first', 'second'],
  );
});

test('capture drops unmeasured candidates and honours a zero limit', () => {
  const page = [
    { src: 'lazy', pixels: 0 },
    { src: 'nan', pixels: Number.NaN },
    { src: 'real', pixels: 25_000 },
  ];
  assert.deepEqual(selectCaptureCandidates(page, 10).map((candidate) => candidate.src), ['real']);
  assert.deepEqual(selectCaptureCandidates(page, 0), []);
  assert.deepEqual(selectCaptureCandidates([], 10), []);
});

test('tab-list thumbs take the newest row per page', () => {
  const rows = [
    { key: 'b-old', pageUrl: 'https://b.test/post', savedAt: 10 },
    { key: 'a-new', pageUrl: 'https://a.test/post', savedAt: 30 },
    { key: 'a-old', pageUrl: 'https://a.test/post', savedAt: 5 },
    { key: 'other', pageUrl: 'https://c.test/post', savedAt: 99 },
  ];
  const picked = pickPageThumbs(rows, ['https://a.test/post', 'https://b.test/post']);
  assert.equal(picked.get('https://a.test/post'), 'a-new');
  assert.equal(picked.get('https://b.test/post'), 'b-old');
  assert.equal(picked.has('https://c.test/post'), false);
});

test('tab-list thumbs stay empty when nothing matches', () => {
  assert.equal(pickPageThumbs([], ['https://a.test/']).size, 0);
  assert.equal(pickPageThumbs([{ key: 'k', pageUrl: 'https://a.test/', savedAt: 1 }], []).size, 0);
  assert.equal(pickPageThumbs([{ key: 'k', pageUrl: 'https://a.test/', savedAt: 1 }], ['https://z.test/']).size, 0);
});

test('preview box keeps the aspect ratio inside the edge', () => {
  assert.deepEqual(fitWithin(1_200, 800, 480), { width: 480, height: 320 });
  assert.deepEqual(fitWithin(800, 1_200, 480), { width: 320, height: 480 });
  assert.deepEqual(fitWithin(480, 480, 480), { width: 480, height: 480 });
});

test('preview box never upscales and collapses invalid input', () => {
  assert.deepEqual(fitWithin(120, 90, 480), { width: 120, height: 90 });
  assert.deepEqual(fitWithin(0, 90, 480), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(120, Number.NaN, 480), { width: 0, height: 0 });
  assert.deepEqual(fitWithin(120, 90, 0), { width: 0, height: 0 });
});

test('gallery window clamps when the store shrank under the grid', () => {
  assert.deepEqual(nextGalleryWindow(30, 48, 24), { offset: 30, limit: 0 });
  assert.deepEqual(nextGalleryWindow(0, 0, 24), { offset: 0, limit: 0 });
  assert.deepEqual(nextGalleryWindow(55, 55, 24), { offset: 55, limit: 0 });
});
