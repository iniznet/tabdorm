import { getConfig } from './config-store';
import { isWakeCooldownActive, resetAllActivity, startWakeCooldown } from './activity';

/**
 * Sleep Avalanche Guard. On an idle→active transition (system wake or user
 * return) the wake cooldown starts and every activity timestamp is reset so
 * the suspension sweep cannot mass-discard on clock-jumped idle math.
 */
export function initIdleGuard(): void {
  chrome.idle.onStateChanged.addListener((state) => {
    void handleIdleStateChange(state);
  });
}

async function handleIdleStateChange(state: string): Promise<void> {
  if (state !== 'active') return;
  const config = await getConfig();
  if (await isWakeCooldownActive()) return;
  await startWakeCooldown(config.suspension.wakeCooldownMs);
  await resetAllActivity();
}
