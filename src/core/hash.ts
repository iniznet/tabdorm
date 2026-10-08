import type { StoredWindow } from '@/types';

/** Deterministic JSON with sorted object keys — order-independent structural hashing. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map((item) => stableStringify(item)).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries
    .map(([key, v]) => `${JSON.stringify(key)}:${stableStringify(v)}`)
    .join(',')}}`;
}

/**
 * Fast FNV-1a structural hash over saved windows. Object key order never
 * affects the result, but tab/window POSITION does — a reordered session is a
 * different session (restoration contiguity depends on index order), so
 * position-sensitive hashing is the lossless dedup semantics for auto
 * snapshots, computed without loading stored history.
 */
export function contentHashOf(windows: StoredWindow[]): string {
  const serialized = stableStringify(windows);
  let hash = 0x811c9dc5;
  for (let i = 0; i < serialized.length; i++) {
    hash ^= serialized.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
