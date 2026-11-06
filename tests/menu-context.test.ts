import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsTabContext } from '../src/core/menu-context.ts';

/** The floor is written out here on purpose: a test that reads the constant it checks cannot fail. */
const TAB_CONTEXT_FLOOR = 150;

const UA_TAIL = 'AppleWebKit/537.36 (KHTML, like Gecko)';

function chromeUserAgent(major: number): string {
  return `Mozilla/5.0 (Windows NT 10.0; Win64; x64) ${UA_TAIL} Chrome/${major}.0.0.0 Safari/537.36`;
}

test('the tab context is chosen exactly at the documented floor', () => {
  assert.equal(supportsTabContext(chromeUserAgent(TAB_CONTEXT_FLOOR)), true);
  assert.equal(supportsTabContext(chromeUserAgent(TAB_CONTEXT_FLOOR + 1)), true);
  assert.equal(supportsTabContext(chromeUserAgent(TAB_CONTEXT_FLOOR - 1)), false);
  // Thorium 130, the build that reported the failure.
  assert.equal(supportsTabContext(chromeUserAgent(130)), false);
});

test('an unreadable version falls back to page context instead of guessing', () => {
  assert.equal(supportsTabContext(''), false);
  assert.equal(supportsTabContext('Mozilla/5.0 Safari/537.36'), false);
  assert.equal(supportsTabContext('Chrome/None'), false);
});
