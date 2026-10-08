import type { UnifiedSession } from '@/types';
import { db, type StoredSession } from './client';

export const DEFAULT_SESSION_PAGE_SIZE = 20;
export const MAX_SESSION_PAGE_SIZE = 100;

export interface SessionPage {
  items: UnifiedSession[];
  /** Keyset cursor: primary-key `rev` of the last returned row, or null at the end. */
  nextCursor: number | null;
  hasMore: boolean;
}

export interface TypedSessionPage {
  items: UnifiedSession[];
  /** Keyset cursor: `timestamp:rev` of the last returned row, or null at the end. */
  nextCursor: string | null;
  hasMore: boolean;
}

function clampLimit(limit: number | undefined): number {
  const requested = limit ?? DEFAULT_SESSION_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(requested), 1), MAX_SESSION_PAGE_SIZE);
}

/**
 * Newest-first cursor pagination over all sessions. Loads at most `limit` rows
 * per call — snapshots are NEVER bulk-loaded into memory.
 */
export async function pageSessions(
  options: { limit?: number; cursor?: number } = {},
): Promise<SessionPage> {
  const limit = clampLimit(options.limit);
  const collection =
    options.cursor !== undefined
      ? db.sessions.where(':id').below(options.cursor)
      : db.sessions.toCollection();
  const rows = await collection.reverse().limit(limit).toArray();
  const last = rows.at(-1);
  return {
    items: rows,
    nextCursor: last ? last.rev : null,
    hasMore: rows.length === limit,
  };
}

/**
 * Newest-first cursor pagination restricted to one session type, backed by the
 * `[type+timestamp]` compound index. The cursor encodes `timestamp:rev` so rows
 * sharing a timestamp never duplicate or skip across pages.
 */
export async function pageSessionsByType(
  type: UnifiedSession['type'],
  options: { limit?: number; cursor?: string } = {},
): Promise<TypedSessionPage> {
  const limit = clampLimit(options.limit);
  const cursor = options.cursor;
  let collection = db.sessions.where('[type+timestamp]').between(
    [type, DexieMinKey],
    [type, cursor === null || cursor === undefined ? DexieMaxKey : decodeTimestamp(cursor)],
  );
  if (cursor !== null && cursor !== undefined) {
    const cursorRev = decodeRev(cursor);
    collection = collection.and((session) => session.rev < cursorRev);
  }
  const rows = await collection.reverse().limit(limit).toArray();
  const last = rows.at(-1);
  return {
    items: rows,
    nextCursor: last ? encodeCursor(last.timestamp, last.rev) : null,
    hasMore: rows.length === limit,
  };
}

export async function getSession(id: string): Promise<UnifiedSession | undefined> {
  return db.sessions.where('id').equals(id).first();
}

export async function putSession(session: UnifiedSession): Promise<number> {
  return db.sessions.add(session);
}

export async function countSessions(): Promise<number> {
  return db.sessions.count();
}

export async function deleteSession(id: string): Promise<void> {
  await db.sessions.where('id').equals(id).delete();
}

/** Retention sweep — deletes sessions older than the cutoff timestamp. */
export async function deleteSessionsOlderThan(cutoffTimestamp: number): Promise<number> {
  return db.sessions.where('timestamp').below(cutoffTimestamp).delete();
}

export function encodeCursor(timestamp: number, rev: number): string {
  return `${timestamp}:${rev}`;
}

function decodeTimestamp(cursor: string): number {
  const ts = Number(cursor.slice(0, cursor.indexOf(':')));
  return Number.isFinite(ts) ? ts : 0;
}

function decodeRev(cursor: string): number {
  const rev = Number(cursor.slice(cursor.indexOf(':') + 1));
  return Number.isFinite(rev) ? rev : Number.MAX_SAFE_INTEGER;
}

// Dexie exposes Dexie.maxKey / Dexie.minKey; imported as values to keep types narrow.
const DexieMinKey = -Infinity;
const DexieMaxKey = Infinity;
