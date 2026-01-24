import { Pool } from "pg";
import { and, desc, eq } from "drizzle-orm";
import { drizzle } from "drizzle-orm/node-postgres";
import { doublePrecision, integer, pgTable, primaryKey, text } from "drizzle-orm/pg-core";
import type { SearchTrackItem } from "./search";
import { DATABASE_URL } from "./config";

const sessions = pgTable("sessions", {
  id: text("id").primaryKey(),
  fileHash: text("file_hash").notNull(),
  filename: text("filename").notNull(),
  createdAt: text("created_at").notNull(),
  updatedAt: text("updated_at").notNull(),
  totalTracks: integer("total_tracks").notNull(),
  currentIndex: integer("current_index").notNull(),
});

const tracks = pgTable(
  "tracks",
  {
    sessionId: text("session_id").notNull(),
    trackIndex: integer("track_index").notNull(),
    trackJson: text("track_json").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.trackIndex] }),
  })
);

const selections = pgTable(
  "selections",
  {
    sessionId: text("session_id").notNull(),
    trackIndex: integer("track_index").notNull(),
    selectionKind: text("selection_kind").notNull(),
    trackId: integer("track_id"),
    itemJson: text("item_json"),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.trackIndex] }),
  })
);

const resultsCache = pgTable(
  "results_cache",
  {
    sessionId: text("session_id").notNull(),
    trackIndex: integer("track_index").notNull(),
    resultsJson: text("results_json").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.sessionId, table.trackIndex] }),
  })
);

const trackMatches = pgTable(
  "track_matches",
  {
    trackUri: text("track_uri").notNull(),
    trackKey: text("track_key").notNull(),
    itemJson: text("item_json").notNull(),
    source: text("source").notNull(),
    confidence: doublePrecision("confidence"),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => ({
    pk: primaryKey({ columns: [table.trackUri, table.trackKey] }),
  })
);

type WebSessionRow = typeof sessions.$inferSelect;
type WebTrackRow = typeof tracks.$inferSelect;
type WebSelectionRow = typeof selections.$inferSelect;
type WebResultsRow = typeof resultsCache.$inferSelect;
type TrackMatchRow = typeof trackMatches.$inferSelect;

export type CachedMatchSource = "deterministic" | "llm";

let dbInstance: ReturnType<typeof drizzle> | null = null;
let poolInstance: Pool | null = null;

async function ensureSchema(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      file_hash TEXT NOT NULL,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      total_tracks INTEGER NOT NULL,
      current_index INTEGER NOT NULL
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS tracks (
      session_id TEXT NOT NULL,
      track_index INTEGER NOT NULL,
      track_json TEXT NOT NULL,
      PRIMARY KEY (session_id, track_index)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS selections (
      session_id TEXT NOT NULL,
      track_index INTEGER NOT NULL,
      selection_kind TEXT NOT NULL,
      track_id INTEGER,
      item_json TEXT,
      PRIMARY KEY (session_id, track_index)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS results_cache (
      session_id TEXT NOT NULL,
      track_index INTEGER NOT NULL,
      results_json TEXT NOT NULL,
      PRIMARY KEY (session_id, track_index)
    );
  `);
  await pool.query(`
    CREATE TABLE IF NOT EXISTS track_matches (
      track_uri TEXT NOT NULL,
      track_key TEXT NOT NULL,
      item_json TEXT NOT NULL,
      source TEXT NOT NULL,
      confidence DOUBLE PRECISION,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (track_uri, track_key)
    );
  `);
}

async function getDb() {
  if (dbInstance) {
    return dbInstance;
  }

  const pool = new Pool({ connectionString: DATABASE_URL });
  poolInstance = pool;
  await ensureSchema(pool);
  dbInstance = drizzle(pool);
  return dbInstance;
}

export type WebSessionSummary = {
  id: string;
  fileHash: string;
  filename: string;
  createdAt: string;
  updatedAt: string;
  totalTracks: number;
  currentIndex: number;
  downloadCount: number;
};

export async function createWebSession(params: {
  id: string;
  fileHash: string;
  filename: string;
  createdAt: string;
  updatedAt: string;
  totalTracks: number;
  currentIndex: number;
  tracks: Array<{ index: number; trackJson: string }>;
}): Promise<void> {
  const db = await getDb();
  await db.insert(sessions).values({
    id: params.id,
    fileHash: params.fileHash,
    filename: params.filename,
    createdAt: params.createdAt,
    updatedAt: params.updatedAt,
    totalTracks: params.totalTracks,
    currentIndex: params.currentIndex,
  });
  if (params.tracks.length > 0) {
    await db.insert(tracks).values(
      params.tracks.map((track) => ({
        sessionId: params.id,
        trackIndex: track.index,
        trackJson: track.trackJson,
      }))
    );
  }
}

export async function listWebSessions(): Promise<WebSessionSummary[]> {
  const db = await getDb();
  const sessionRows = await db.select().from(sessions).orderBy(desc(sessions.updatedAt));
  if (sessionRows.length === 0) return [];
  const rows = await db
    .select({ sessionId: selections.sessionId })
    .from(selections)
    .where(eq(selections.selectionKind, "track"));
  const counts = new Map<string, number>();
  for (const row of rows) {
    counts.set(row.sessionId, (counts.get(row.sessionId) ?? 0) + 1);
  }
  return sessionRows.map((session) => ({
    id: session.id,
    fileHash: session.fileHash,
    filename: session.filename,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
    totalTracks: session.totalTracks,
    currentIndex: session.currentIndex,
    downloadCount: counts.get(session.id) ?? 0,
  }));
}

export async function getWebSessionMeta(sessionId: string): Promise<WebSessionRow | null> {
  const db = await getDb();
  const rows = await db.select().from(sessions).where(eq(sessions.id, sessionId));
  return rows[0] ?? null;
}

export async function getWebSessionTracks(sessionId: string): Promise<WebTrackRow[]> {
  const db = await getDb();
  return db.select().from(tracks).where(eq(tracks.sessionId, sessionId));
}

export async function getWebSessionSelections(sessionId: string): Promise<WebSelectionRow[]> {
  const db = await getDb();
  return db.select().from(selections).where(eq(selections.sessionId, sessionId));
}

export async function getWebSessionResults(sessionId: string): Promise<WebResultsRow[]> {
  const db = await getDb();
  return db.select().from(resultsCache).where(eq(resultsCache.sessionId, sessionId));
}

export async function upsertWebSelection(params: {
  sessionId: string;
  trackIndex: number;
  selectionKind: string;
  trackId: number | null;
  itemJson: string | null;
  updatedAt: string;
}): Promise<void> {
  const db = await getDb();
  await db
    .insert(selections)
    .values({
      sessionId: params.sessionId,
      trackIndex: params.trackIndex,
      selectionKind: params.selectionKind,
      trackId: params.trackId,
      itemJson: params.itemJson,
    })
    .onConflictDoUpdate({
      target: [selections.sessionId, selections.trackIndex],
      set: {
        selectionKind: params.selectionKind,
        trackId: params.trackId,
        itemJson: params.itemJson,
      },
    });
  await db
    .update(sessions)
    .set({ currentIndex: params.trackIndex + 1, updatedAt: params.updatedAt })
    .where(eq(sessions.id, params.sessionId));
}

export async function upsertWebSelectionWithoutIndex(params: {
  sessionId: string;
  trackIndex: number;
  selectionKind: string;
  trackId: number | null;
  itemJson: string | null;
  updatedAt: string;
}): Promise<void> {
  const db = await getDb();
  await db
    .insert(selections)
    .values({
      sessionId: params.sessionId,
      trackIndex: params.trackIndex,
      selectionKind: params.selectionKind,
      trackId: params.trackId,
      itemJson: params.itemJson,
    })
    .onConflictDoUpdate({
      target: [selections.sessionId, selections.trackIndex],
      set: {
        selectionKind: params.selectionKind,
        trackId: params.trackId,
        itemJson: params.itemJson,
      },
    });
  await db.update(sessions).set({ updatedAt: params.updatedAt }).where(eq(sessions.id, params.sessionId));
}

export async function deleteWebSelection(sessionId: string, trackIndex: number, updatedAt: string): Promise<void> {
  const db = await getDb();
  await db
    .delete(selections)
    .where(and(eq(selections.sessionId, sessionId), eq(selections.trackIndex, trackIndex)));
  await db.update(sessions).set({ updatedAt }).where(eq(sessions.id, sessionId));
}

export async function upsertWebResults(params: {
  sessionId: string;
  trackIndex: number;
  resultsJson: string;
  updatedAt: string;
}): Promise<void> {
  const db = await getDb();
  await db
    .insert(resultsCache)
    .values({
      sessionId: params.sessionId,
      trackIndex: params.trackIndex,
      resultsJson: params.resultsJson,
    })
    .onConflictDoUpdate({
      target: [resultsCache.sessionId, resultsCache.trackIndex],
      set: { resultsJson: params.resultsJson },
    });
  await db.update(sessions).set({ updatedAt: params.updatedAt }).where(eq(sessions.id, params.sessionId));
}

export async function updateWebSessionIndex(sessionId: string, currentIndex: number, updatedAt: string): Promise<void> {
  const db = await getDb();
  await db.update(sessions).set({ currentIndex, updatedAt }).where(eq(sessions.id, sessionId));
}

export type CachedTrackMatch = {
  item: SearchTrackItem;
  source: CachedMatchSource;
  confidence: number | null;
  updatedAt: string;
};

export async function getCachedTrackMatch(trackUri: string, trackKey: string): Promise<CachedTrackMatch | null> {
  const db = await getDb();
  const rows: TrackMatchRow[] = await db
    .select()
    .from(trackMatches)
    .where(and(eq(trackMatches.trackUri, trackUri), eq(trackMatches.trackKey, trackKey)))
    .limit(1);

  const row = rows[0];
  if (!row) return null;

  try {
    const item = JSON.parse(row.itemJson) as SearchTrackItem;
    return {
      item,
      source: (row.source as CachedMatchSource) ?? "deterministic",
      confidence: typeof row.confidence === "number" ? row.confidence : null,
      updatedAt: row.updatedAt,
    };
  } catch {
    return null;
  }
}

export async function upsertCachedTrackMatch(params: {
  trackUri: string;
  trackKey: string;
  item: SearchTrackItem;
  source: CachedMatchSource;
  confidence: number | null;
  updatedAt: string;
}): Promise<void> {
  const db = await getDb();
  const itemJson = JSON.stringify(params.item);
  await db
    .insert(trackMatches)
    .values({
      trackUri: params.trackUri,
      trackKey: params.trackKey,
      itemJson,
      source: params.source,
      confidence: params.confidence,
      updatedAt: params.updatedAt,
    })
    .onConflictDoUpdate({
      target: [trackMatches.trackUri, trackMatches.trackKey],
      set: {
        itemJson,
        source: params.source,
        confidence: params.confidence,
        updatedAt: params.updatedAt,
      },
    });
}

export async function deleteWebSession(sessionId: string): Promise<void> {
  const db = await getDb();
  await db.delete(selections).where(eq(selections.sessionId, sessionId));
  await db.delete(resultsCache).where(eq(resultsCache.sessionId, sessionId));
  await db.delete(tracks).where(eq(tracks.sessionId, sessionId));
  await db.delete(sessions).where(eq(sessions.id, sessionId));
}

export async function closeDbPool(): Promise<void> {
  if (poolInstance) {
    await poolInstance.end();
  }
}
