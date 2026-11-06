import assert from 'node:assert/strict';
import test from 'node:test';
import {
  exceedsByteCeiling,
  formatByteSize,
  hostOfUrl,
  isCacheableImageUrl,
  normalizeImageKey,
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
  assert.equal(exceedsByteCeiling(900 * 1024, config({ maxImageKilobytes: 1_024 })), false);
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
  assert.deepEqual(selectOverBudget(records, 0), ['oldest', 'middle', 'newest']);
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
