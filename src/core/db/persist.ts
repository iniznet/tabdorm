/**
 * Requests durable storage so session history survives aggressive eviction.
 * Idempotent — resolves once the browser grants or denies persistence.
 */
export async function ensureStoragePersistence(): Promise<boolean> {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage?.persist) return false;
    if (await navigator.storage.persisted()) return true;
    const granted = await navigator.storage.persist();
    if (!granted) console.warn('[tabdorm] navigator.storage.persist() denied; history may be evicted under pressure.');
    return granted;
  } catch (error) {
    console.warn('[tabdorm] storage persistence probe failed.', error);
    return false;
  }
}
