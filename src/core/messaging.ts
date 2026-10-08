import type { BackgroundRequest, BackgroundResponse } from '@/types/messages';
import { parseBackgroundRequest } from '@/types/messages';

type RequestHandler = (request: BackgroundRequest) => Promise<unknown>;

/**
 * Registers the background message handler. MUST be called synchronously at
 * service-worker startup; responses are delivered asynchronously (return true).
 */
export function registerBackgroundMessageHandler(handle: RequestHandler): void {
  chrome.runtime.onMessage.addListener((raw, _sender, sendResponse) => {
    const parsed = parseBackgroundRequest(raw);
    if (!parsed.ok) {
      sendResponse({ ok: false, error: parsed.error } satisfies BackgroundResponse);
      return false;
    }
    handle(parsed.request)
      .then((payload) => sendResponse({ ok: true, payload } satisfies BackgroundResponse))
      .catch((error: unknown) => {
        console.warn('[tabdorm] message handler failed.', error);
        sendResponse({ ok: false, error: error instanceof Error ? error.message : String(error) } satisfies BackgroundResponse);
      });
    return true;
  });
}

/** Fire-and-report message sender for UI surfaces. Never throws. */
export async function sendToBackground(request: BackgroundRequest): Promise<BackgroundResponse> {
  try {
    return (await chrome.runtime.sendMessage(request)) as BackgroundResponse;
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}
