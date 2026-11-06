import assert from 'node:assert/strict';
import test from 'node:test';
import {
  contentLengthRefused,
  declaredBytesOfDataUrl,
  inlineSessionKey,
  isInlineImageSource,
  promoteSessionRow,
  purgeRowsForTab,
  refuseReason,
  selectSessionOverBudget,
  sessionKey,
  shouldCaptureSize,
  shouldReadInline,
  shouldWriteSessionRow,
  sniffImageMime,
  tabOfSessionKey,
} from '../src/core/image-session.ts';
import { blobImageKey } from '../src/core/image-cache.ts';
import type { ImageCacheConfig } from '../src/types/config.ts';
import type { CachedSessionImage } from '../src/types/image-cache.ts';

const config = (overrides: Partial<ImageCacheConfig> = {}): ImageCacheConfig => ({
  enabled: true,
  ttlMinutes: 1_440,
  maxMegabytes: 64,
  maxImageKilobytes: 512,
  minPixels: 4_096,
  minBytes: 8_192,
  autoCapture: true,
  sessionMaxImages: 200,
  sessionMaxMegabytes: 64,
  captureDeadlineMs: 1_500,
  ...overrides,
});

const row = (key: string, tabId: number, size: number, lastUsed: number) => ({ key, tabId, size, lastUsed });

test('only a picture the page holds itself is inline', () => {
  assert.equal(isInlineImageSource('blob:https://a.example/6b1e'), true);
  assert.equal(isInlineImageSource('data:image/png;base64,iVBORw0KGgo='), true);
  // A data url that is not an image is not a picture, and neither is a page url.
  assert.equal(isInlineImageSource('data:text/html,<b>x</b>'), false);
  assert.equal(isInlineImageSource('https://a.example/x.png'), false);
  assert.equal(isInlineImageSource(''), false);
});

test('a payload length is read as base64, never trusted as a byte count', () => {
  // 4 base64 characters stand for 3 bytes, and the header costs nothing.
  assert.equal(declaredBytesOfDataUrl('data:image/png;base64,' + 'A'.repeat(4)), 3);
  assert.equal(declaredBytesOfDataUrl('data:image/png;base64,' + 'A'.repeat(8_192)), 6_144);
  // Anything unreadable reports 0, which never refuses on its own.
  assert.equal(declaredBytesOfDataUrl('data:image/png;base64'), 0);
  assert.equal(declaredBytesOfDataUrl('data:image/png;base64,'), 0);
  assert.equal(declaredBytesOfDataUrl('data:text/plain,hello'), 0);
  assert.equal(declaredBytesOfDataUrl('https://a.example/x.png'), 0);
});

test('an inline picture needs a rendered box above the pixel floor', () => {
  const cfg = config();
  assert.equal(shouldReadInline(4_095, cfg), false);
  assert.equal(shouldReadInline(4_096, cfg), true);
  // An unmeasured box is not a rejection: the byte floor decides after the read.
  assert.equal(shouldReadInline(0, cfg), true);
  // The floor is the knob, so a page with no floor keeps everything rendered.
  assert.equal(shouldReadInline(1, config({ minPixels: 0 })), true);
});

test('an inline row is keyed by its digest, so one picture is one row', () => {
  // One literal for both bands: the offline key and the session key agree.
  assert.equal(inlineSessionKey(7, 'deadbeef'), '7:' + blobImageKey('deadbeef'));
  assert.equal(inlineSessionKey(7, 'deadbeef'), '7:blob-sha256:deadbeef');
  // The same picture announced again lands on the same key, whatever its uuid.
  assert.equal(inlineSessionKey(7, 'deadbeef'), inlineSessionKey(7, 'deadbeef'));
});

test('a session key carries its tab, so one tab deletes in one range', () => {
  assert.equal(sessionKey(7, 'https://a.example/x.png'), '7:https://a.example/x.png');
  assert.equal(tabOfSessionKey('7:https://a.example/x.png'), 7);
  assert.equal(tabOfSessionKey('https://a.example/x.png'), null);
  assert.equal(tabOfSessionKey('0:x'), null);
  assert.equal(tabOfSessionKey('abc:x'), null);
});

test('the byte floor and the ceiling both bound a session read', () => {
  const cfg = config();
  assert.equal(shouldCaptureSize(0, cfg), false);
  assert.equal(shouldCaptureSize(8_191, cfg), false);
  assert.equal(shouldCaptureSize(8_192, cfg), true);
  assert.equal(shouldCaptureSize(512 * 1024, cfg), true);
  assert.equal(shouldCaptureSize(512 * 1024 + 1, cfg), false);
  // Zero ceiling is no ceiling, the same meaning it carries offline.
  const uncapped = config({ maxImageKilobytes: 0 });
  assert.equal(shouldCaptureSize(40 * 1024 * 1024, uncapped), true);
});

test('a declared length can refuse a read before the body is fetched', () => {
  const hard = 64 * 1024 * 1024;
  const cfg = config();
  assert.equal(contentLengthRefused(0, cfg, hard), false);
  assert.equal(contentLengthRefused(Number.NaN, cfg, hard), false);
  assert.equal(contentLengthRefused(512 * 1024, cfg, hard), false);
  assert.equal(contentLengthRefused(512 * 1024 + 1, cfg, hard), true);
  // The hard cap holds whatever the config says, including no ceiling.
  const uncapped = config({ maxImageKilobytes: 0 });
  assert.equal(contentLengthRefused(40 * 1024 * 1024, uncapped, hard), false);
  assert.equal(contentLengthRefused(hard + 1, uncapped, hard), true);
});

test('a key the offline store already holds never enters the session band', () => {
  assert.equal(shouldWriteSessionRow(false), true);
  assert.equal(shouldWriteSessionRow(true), false);
});

test('the per-tab count cap drops that tab s least recently seen rows only', () => {
  const rows = [
    row('1:a', 1, 10, 100),
    row('1:b', 1, 10, 200),
    row('1:c', 1, 10, 300),
    row('2:a', 2, 10, 150),
  ];
  const dropped = selectSessionOverBudget(rows, config({ sessionMaxImages: 2, sessionMaxMegabytes: 0 }));
  assert.deepEqual(dropped, ['1:a']);
});

test('the global byte budget drops across tabs, least recently used first', () => {
  const rows = [
    row('1:a', 1, 40 * 1024 * 1024, 100),
    row('1:b', 1, 40 * 1024 * 1024, 300),
    row('2:a', 2, 40 * 1024 * 1024, 200),
  ];
  const dropped = selectSessionOverBudget(rows, config({ sessionMaxMegabytes: 80, sessionMaxImages: 0 }));
  assert.deepEqual(dropped, ['1:a']);
});

test('zero caps and a fitting band drop nothing', () => {
  const rows = [row('1:a', 1, 1_000, 1), row('2:a', 2, 1_000, 2)];
  assert.deepEqual(selectSessionOverBudget(rows, config({ sessionMaxImages: 0, sessionMaxMegabytes: 0 })), []);
  assert.deepEqual(selectSessionOverBudget(rows, config()), []);
});

test('promotion moves the row to its offline key and restarts the clock', () => {
  const session: CachedSessionImage = {
    key: sessionKey(4, 'https://a.example/x.png'),
    tabId: 4,
    imageKey: 'https://a.example/x.png',
    host: 'a.example',
    pageUrl: 'https://a.example/page',
    mime: 'image/png',
    size: 1_024,
    savedAt: 10,
    lastUsed: 20,
    blob: new Blob([new Uint8Array(8)], { type: 'image/png' }),
  };
  const promoted = promoteSessionRow(session, 9_999);
  assert.equal(promoted.key, 'https://a.example/x.png');
  assert.equal(promoted.savedAt, 9_999);
  assert.equal(promoted.lastUsed, 9_999);
  assert.equal(promoted.size, 1_024);
  assert.equal(promoted.preview, undefined);
});

test('a closed tab purges exactly its own rows', () => {
  const rows = [{ key: '1:a', tabId: 1 }, { key: '2:a', tabId: 2 }, { key: '1:b', tabId: 1 }];
  assert.deepEqual(purgeRowsForTab(rows, 1), ['1:a', '1:b']);
  assert.deepEqual(purgeRowsForTab(rows, 3), []);
});

test('capture refuses a disabled feature, a private tab, and a non-image scheme', () => {
  const ok = { incognito: false, discarded: false };
  assert.equal(refuseReason('https://a.example/x.png', ok, config()), null);
  assert.equal(refuseReason('https://a.example/x.png', ok, config({ enabled: false })), 'disabled');
  assert.equal(refuseReason('https://a.example/x.png', ok, config({ autoCapture: false })), 'disabled');
  assert.equal(refuseReason('https://a.example/x.png', { ...ok, incognito: true }, config()), 'incognito');
  assert.equal(refuseReason('https://a.example/x.png', { ...ok, discarded: true }, config()), 'discarded');
  assert.equal(refuseReason('chrome-extension://abc/x.png', ok, config()), 'scheme');
  assert.equal(refuseReason('https://user:pw@a.example/x.png', ok, config()), 'credentials');
  assert.equal(refuseReason('not a url', ok, config()), 'invalid_url');
});

test('a declared image type wins, and octet-stream is resolved by magic bytes', () => {
  const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a]);
  const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
  const gif = new Uint8Array([0x47, 0x49, 0x46, 0x38]);
  const webp = new Uint8Array([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);
  const avif = new Uint8Array([0, 0, 0, 0x20, 0x66, 0x74, 0x79, 0x70, 0x61, 0x76, 0x69, 0x66]);
  const html = new Uint8Array([0x3c, 0x21, 0x44, 0x4f]);

  assert.equal(sniffImageMime('image/png', html), 'image/png');
  assert.equal(sniffImageMime('application/octet-stream', png), 'image/png');
  assert.equal(sniffImageMime('application/octet-stream', jpeg), 'image/jpeg');
  assert.equal(sniffImageMime('application/octet-stream', gif), 'image/gif');
  assert.equal(sniffImageMime('application/octet-stream', webp), 'image/webp');
  assert.equal(sniffImageMime('application/octet-stream', avif), 'image/avif');
  assert.equal(sniffImageMime('text/html', html), null);
  assert.equal(sniffImageMime('', new Uint8Array([])), null);
});
