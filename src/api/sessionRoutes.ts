import { parseCSV } from "../csv";
import { resolveLlmMatch, shouldAutoSelect } from "../llmMatch";
import { searchTracks, type SearchTrackItem } from "../search";
import {
  createWebSession,
  deleteWebSelection,
  deleteWebSession,
  getCachedTrackMatch,
  getWebSessionMeta,
  getWebSessionResults,
  getWebSessionSelections,
  getWebSessionTracks,
  listWebSessions,
  upsertCachedTrackMatch,
  upsertWebResults,
  upsertWebSelection,
  updateWebSessionIndex,
  type CachedMatchSource,
} from "../db";
import type { DownloadEntry, MatchResponse } from "../../lib/types";
import type { Track } from "../types";
import { corsHeaders } from "./cors";

export type Selection =
  | { kind: "track"; item: SearchTrackItem }
  | { kind: "none" }
  | { kind: "skip" };

export type Session = {
  id: string;
  fileHash: string;
  filename: string;
  tracks: Track[];
  index: number;
  selections: Map<number, Selection>;
  resultsCache: Map<number, SearchTrackItem[]>;
  suggestedCache: Map<number, number | null>;
  resultsInFlight: Set<number>;
  suggestedInFlight: Set<number>;
};

type SuggestedMatch = {
  item: SearchTrackItem;
  source: CachedMatchSource;
  confidence: number | null;
};

const sessions = new Map<string, Session>();

function buildTrackKey(artist: string, title: string, album: string): string {
  return [artist, title, album]
    .map((value) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim())
    .join("|");
}

async function hashContent(content: string): Promise<string> {
  const buffer = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function resolveDeterministicMatch(track: Track, items: SearchTrackItem[]): SearchTrackItem | null {
  const targetKey = buildTrackKey(track.artistName, track.trackName, track.albumName);
  const matches = items.filter((item) => {
    return buildTrackKey(item.artist.name, item.title, item.album.title) === targetKey;
  });

  if (matches.length === 1) {
    return matches[0] ?? null;
  }

  return null;
}

function buildCoverUrl(coverId?: string | null): string | null {
  if (!coverId) return null;
  const normalized = coverId.replace(/-/g, "/");
  return `https://resources.tidal.com/images/${normalized}/320x320.jpg`;
}

function resolveCoverValue(coverId?: string | null): string | null {
  if (!coverId) return null;
  if (coverId.startsWith("http://") || coverId.startsWith("https://")) {
    return coverId;
  }
  return buildCoverUrl(coverId);
}

function serializeSelectionItem(item: SearchTrackItem | null): string | null {
  return item ? JSON.stringify(item) : null;
}

function parseSelectionItem(value: string | null): SearchTrackItem | null {
  if (!value) return null;
  try {
    return JSON.parse(value) as SearchTrackItem;
  } catch {
    return null;
  }
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T | null> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    promise
      .then((value) => {
        clearTimeout(timer);
        resolve(value);
      })
      .catch((error) => {
        clearTimeout(timer);
        reject(error);
      });
  });
}

function buildTrackCacheKey(track: Track): { trackUri: string | null; trackKey: string } {
  const trackUri = track.trackUri?.trim() ?? "";
  return {
    trackUri: trackUri || null,
    trackKey: buildTrackKey(track.artistName, track.trackName, track.albumName),
  };
}

async function cacheTrackMatch(track: Track, item: SearchTrackItem, source: CachedMatchSource, confidence: number | null): Promise<void> {
  const { trackUri, trackKey } = buildTrackCacheKey(track);
  if (!trackUri) return;

  try {
    await upsertCachedTrackMatch({
      trackUri,
      trackKey,
      item,
      source,
      confidence,
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn(`⚠️ Cache write failed: ${error}`);
  }
}

async function resolveSuggestedItem(
  track: Track,
  results: SearchTrackItem[],
  timeoutMs: number
): Promise<SuggestedMatch | null> {
  const deterministic = resolveDeterministicMatch(track, results);
  if (deterministic) {
    return { item: deterministic, source: "deterministic", confidence: null };
  }

  try {
    const llmResult = await withTimeout(resolveLlmMatch(track, results), timeoutMs);
    if (!llmResult) {
      return null;
    }
    if (llmResult.kind === "match" && shouldAutoSelect(llmResult.confidence)) {
      console.log(`✓ Web LLM matched with confidence ${llmResult.confidence.toFixed(2)}`);
      return { item: llmResult.item, source: "llm", confidence: llmResult.confidence };
    }
  } catch (error) {
    console.warn(`⚠️ Web LLM match failed: ${error}`);
  }

  return null;
}

async function tryLoadCachedResults(
  session: Session,
  index: number,
  track: Track
): Promise<SearchTrackItem[] | null> {
  const { trackUri, trackKey } = buildTrackCacheKey(track);
  if (!trackUri) return null;

  try {
    const cached = await getCachedTrackMatch(trackUri, trackKey);
    if (!cached) return null;

    const items = [cached.item];
    session.resultsCache.set(index, items);
    session.suggestedCache.set(index, cached.item.id ?? null);
    await upsertWebResults({
      sessionId: session.id,
      trackIndex: index,
      resultsJson: JSON.stringify(items),
      updatedAt: new Date().toISOString(),
    });
    console.log(`✓ Cache hit for track index ${index}`);
    return items;
  } catch (error) {
    console.warn(`⚠️ Cache lookup failed: ${error}`);
    return null;
  }
}

async function prefetchResults(session: Session, index: number): Promise<void> {
  if (session.resultsCache.has(index) || session.resultsInFlight.has(index)) {
    return;
  }

  const track = session.tracks[index];
  if (!track) return;

  const cachedResults = await tryLoadCachedResults(session, index, track);
  if (cachedResults) {
    return;
  }

  session.resultsInFlight.add(index);
  try {
    const query = `${track.artistName} - ${track.trackName}`.trim();
    const results = await searchTracks(query);
    session.resultsCache.set(index, results);
    await upsertWebResults({
      sessionId: session.id,
      trackIndex: index,
      resultsJson: JSON.stringify(results),
      updatedAt: new Date().toISOString(),
    });
  } catch (error) {
    console.warn(`⚠️ Web search failed: ${error}`);
  } finally {
    session.resultsInFlight.delete(index);
  }
}

async function loadResultsForIndex(session: Session, index: number): Promise<SearchTrackItem[]> {
  const cached = session.resultsCache.get(index);
  if (cached) {
    return cached;
  }

  if (session.resultsInFlight.has(index)) {
    const startedAt = Date.now();
    while (session.resultsInFlight.has(index)) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      const nextCached = session.resultsCache.get(index);
      if (nextCached) {
        return nextCached;
      }
      if (Date.now() - startedAt > 15000) {
        break;
      }
    }
  }

  const track = session.tracks[index];
  if (!track) return [];

  const cachedResults = await tryLoadCachedResults(session, index, track);
  if (cachedResults) {
    return cachedResults;
  }

  session.resultsInFlight.add(index);
  try {
    const query = `${track.artistName} - ${track.trackName}`.trim();
    const results = await searchTracks(query);
    session.resultsCache.set(index, results);
    await upsertWebResults({
      sessionId: session.id,
      trackIndex: index,
      resultsJson: JSON.stringify(results),
      updatedAt: new Date().toISOString(),
    });
    return results;
  } catch (error) {
    console.warn(`⚠️ Web search failed: ${error}`);
    return [];
  } finally {
    session.resultsInFlight.delete(index);
  }
}

async function prefetchSuggestion(
  session: Session,
  index: number,
  track: Track,
  results: SearchTrackItem[]
): Promise<void> {
  if (session.suggestedCache.has(index) || session.suggestedInFlight.has(index)) {
    return;
  }

  session.suggestedInFlight.add(index);
  try {
    const suggested = await resolveSuggestedItem(track, results, 1500);
    const suggestedId = suggested?.item.id ?? null;
    session.suggestedCache.set(index, suggestedId);
    if (suggested && suggestedId !== null) {
      await cacheTrackMatch(track, suggested.item, suggested.source, suggested.confidence);
    }
  } finally {
    session.suggestedInFlight.delete(index);
  }
}

async function loadSuggestionForIndex(
  session: Session,
  index: number,
  track: Track,
  results: SearchTrackItem[]
): Promise<number | null> {
  if (session.suggestedCache.has(index)) {
    return session.suggestedCache.get(index) ?? null;
  }

  if (session.suggestedInFlight.has(index)) {
    const startedAt = Date.now();
    while (session.suggestedInFlight.has(index)) {
      await new Promise((resolve) => setTimeout(resolve, 120));
      if (session.suggestedCache.has(index)) {
        return session.suggestedCache.get(index) ?? null;
      }
      if (Date.now() - startedAt > 5000) {
        break;
      }
    }
  }

  session.suggestedInFlight.add(index);
  try {
    const suggested = await resolveSuggestedItem(track, results, 1500);
    const suggestedId = suggested?.item.id ?? null;
    session.suggestedCache.set(index, suggestedId);
    if (suggested && suggestedId !== null) {
      await cacheTrackMatch(track, suggested.item, suggested.source, suggested.confidence);
    }
    return suggestedId;
  } finally {
    session.suggestedInFlight.delete(index);
  }
}

async function loadSessionFromDb(sessionId: string): Promise<Session | null> {
  const meta = await getWebSessionMeta(sessionId);
  if (!meta) return null;

  const [tracksRows, selectionsRows, resultsRows] = await Promise.all([
    getWebSessionTracks(sessionId),
    getWebSessionSelections(sessionId),
    getWebSessionResults(sessionId),
  ]);

  const tracks = tracksRows
    .sort((a, b) => a.trackIndex - b.trackIndex)
    .map((row) => JSON.parse(row.trackJson) as Track);

  const selections = new Map<number, Selection>();
  for (const row of selectionsRows) {
    if (row.selectionKind === "track") {
      const item = parseSelectionItem(row.itemJson);
      if (item) {
        selections.set(row.trackIndex, { kind: "track", item });
      }
    } else if (row.selectionKind === "none") {
      selections.set(row.trackIndex, { kind: "none" });
    } else if (row.selectionKind === "skip") {
      selections.set(row.trackIndex, { kind: "skip" });
    }
  }

  const resultsCache = new Map<number, SearchTrackItem[]>();
  for (const row of resultsRows) {
    try {
      resultsCache.set(row.trackIndex, JSON.parse(row.resultsJson) as SearchTrackItem[]);
    } catch {
      resultsCache.set(row.trackIndex, []);
    }
  }

  return {
    id: meta.id,
    fileHash: meta.fileHash,
    filename: meta.filename,
    tracks,
    index: meta.currentIndex,
    selections,
    resultsCache,
    suggestedCache: new Map(),
    resultsInFlight: new Set(),
    suggestedInFlight: new Set(),
  };
}

function buildDownloadEntries(session: Session): DownloadEntry[] {
  const entries: DownloadEntry[] = [];
  for (const [index, selection] of session.selections.entries()) {
    if (selection.kind !== "track") continue;
    const track = session.tracks[index];
    if (!track) continue;
    entries.push({
      index,
      track,
      item: {
        ...selection.item,
        album: {
          ...selection.item.album,
          cover: resolveCoverValue(selection.item.album.cover),
        },
      },
    });
  }
  return entries.sort((a, b) => b.index - a.index);
}

async function buildSessionNextPayload(session: Session): Promise<MatchResponse> {
  if (session.index >= session.tracks.length) {
    return {
      done: true,
      index: session.index,
      total: session.tracks.length,
      track: null,
      results: [],
      suggestedId: null,
    };
  }

  const track = session.tracks[session.index];
  if (!track) {
    return {
      done: true,
      index: session.index,
      total: session.tracks.length,
      track: null,
      results: [],
      suggestedId: null,
    };
  }

  const results = await loadResultsForIndex(session, session.index);
  const suggestedId = await loadSuggestionForIndex(session, session.index, track, results);

  const nextIndex = session.index + 1;
  if (nextIndex < session.tracks.length) {
    void prefetchResults(session, nextIndex);
  }

  return {
    done: false,
    index: session.index,
    total: session.tracks.length,
    track,
    results: results.map((item) => ({
      ...item,
      album: {
        ...item.album,
        cover: resolveCoverValue(item.album.cover),
      },
    })),
    suggestedId,
  };
}

async function getSessionNext(session: Session): Promise<Response> {
  const payload = await buildSessionNextPayload(session);
  return Response.json(payload, { headers: corsHeaders });
}

export async function getSessionById(sessionId: string): Promise<Session | null> {
  let session = sessions.get(sessionId);
  if (!session) {
    const restored = await loadSessionFromDb(sessionId);
    if (restored) {
      session = restored;
      sessions.set(sessionId, restored);
    }
  }
  return session ?? null;
}

export async function getSessionSnapshot(
  sessionId: string,
  indexOverride?: number | null
): Promise<{ match: MatchResponse; downloads: DownloadEntry[] } | null> {
  const session = await getSessionById(sessionId);
  if (!session) {
    return null;
  }

  if (typeof indexOverride === "number" && Number.isFinite(indexOverride)) {
    if (indexOverride < 0 || indexOverride >= session.tracks.length) {
      return null;
    }
    session.index = indexOverride;
    await updateWebSessionIndex(session.id, session.index, new Date().toISOString());
  }

  const match = await buildSessionNextPayload(session);
  const downloads = buildDownloadEntries(session);
  return { match, downloads };
}

export async function handleSessionRoutes(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname === "/api/session" && request.method === "POST") {
    const formData = await request.formData();
    const file = formData.get("file");
    if (!(file instanceof File)) {
      return new Response("Missing CSV file.", { status: 400, headers: corsHeaders });
    }

    const content = await file.text();
    const tracks = parseCSV(content);
    const fileHash = await hashContent(content);
    const sessionId = crypto.randomUUID();
    const timestamp = new Date().toISOString();

    const session: Session = {
      id: sessionId,
      fileHash,
      filename: file.name,
      tracks,
      index: 0,
      selections: new Map(),
      resultsCache: new Map(),
      suggestedCache: new Map(),
      resultsInFlight: new Set(),
      suggestedInFlight: new Set(),
    };
    sessions.set(sessionId, session);

    await createWebSession({
      id: sessionId,
      fileHash,
      filename: file.name,
      createdAt: timestamp,
      updatedAt: timestamp,
      totalTracks: tracks.length,
      currentIndex: 0,
      tracks: tracks.map((track, index) => ({ index, trackJson: JSON.stringify(track) })),
    });

    return Response.json({ sessionId, totalTracks: tracks.length }, { headers: corsHeaders });
  }

  if (url.pathname === "/api/sessions" && request.method === "GET") {
    const sessionList = await listWebSessions();
    return Response.json({ sessions: sessionList }, { headers: corsHeaders });
  }

  if (url.pathname.startsWith("/api/session/") && request.method === "GET") {
    const [, , , sessionId, action, param] = url.pathname.split("/");
    if (!sessionId || action === "download") {
      return null;
    }

    const session = await getSessionById(sessionId);
    if (!session) {
      return new Response("Session not found.", { status: 404, headers: corsHeaders });
    }

    if (action === "next") {
      return getSessionNext(session);
    }

    if (action === "track" && param) {
      const index = Number(param);
      if (!Number.isFinite(index) || index < 0 || index >= session.tracks.length) {
        return new Response("Invalid track index.", { status: 400, headers: corsHeaders });
      }
      session.index = index;
      await updateWebSessionIndex(session.id, session.index, new Date().toISOString());
      return getSessionNext(session);
    }

    if (action === "tracks") {
      const tracks = session.tracks.map((track, index) => ({ index, track }));
      return Response.json({ tracks }, { headers: corsHeaders });
    }

    if (action === "navigate") {
      const direction = url.searchParams.get("direction");
      if (direction === "prev") {
        session.index = Math.max(0, session.index - 1);
      } else if (direction === "next") {
        session.index = Math.min(session.tracks.length, session.index + 1);
      } else {
        return new Response("Invalid navigation direction.", { status: 400, headers: corsHeaders });
      }
      await updateWebSessionIndex(session.id, session.index, new Date().toISOString());
      return getSessionNext(session);
    }

    if (action === "downloads") {
      return Response.json({ downloads: buildDownloadEntries(session) }, { headers: corsHeaders });
    }

    return null;
  }

  if (url.pathname.startsWith("/api/session/") && request.method === "POST") {
    const [, , , sessionId, action] = url.pathname.split("/");
    if (!sessionId) {
      return null;
    }

    const session = await getSessionById(sessionId);
    if (!session) {
      return new Response("Session not found.", { status: 404, headers: corsHeaders });
    }

    if (action === "select") {
      const payload = (await request.json()) as { kind?: string; trackId?: number };
      const track = session.tracks[session.index];
      const results = session.resultsCache.get(session.index) ?? [];
      const updatedAt = new Date().toISOString();

      if (!track) {
        return Response.json({ done: true, index: session.index, total: session.tracks.length }, { headers: corsHeaders });
      }

      if (payload.kind === "track") {
        const selected = results.find((item) => item.id === payload.trackId);
        if (!selected) {
          return new Response("Selected track not found.", { status: 400, headers: corsHeaders });
        }
        session.selections.set(session.index, { kind: "track", item: selected });
        await upsertWebSelection({
          sessionId: session.id,
          trackIndex: session.index,
          selectionKind: "track",
          trackId: selected.id,
          itemJson: serializeSelectionItem(selected),
          updatedAt,
        });
      } else if (payload.kind === "none") {
        session.selections.set(session.index, { kind: "none" });
        await upsertWebSelection({
          sessionId: session.id,
          trackIndex: session.index,
          selectionKind: "none",
          trackId: null,
          itemJson: null,
          updatedAt,
        });
      } else {
        session.selections.set(session.index, { kind: "skip" });
        await upsertWebSelection({
          sessionId: session.id,
          trackIndex: session.index,
          selectionKind: "skip",
          trackId: null,
          itemJson: null,
          updatedAt,
        });
      }

      session.index += 1;
      return getSessionNext(session);
    }

    if (action === "remove") {
      const payload = (await request.json()) as { index?: number };
      const index = payload.index;
      if (typeof index !== "number" || !Number.isFinite(index)) {
        return new Response("Invalid track index.", { status: 400, headers: corsHeaders });
      }
      session.selections.delete(index);
      await deleteWebSelection(session.id, index, new Date().toISOString());
      return Response.json({ ok: true }, { headers: corsHeaders });
    }

    if (action === "navigate") {
      const payload = (await request.json()) as { direction?: string };
      if (payload.direction === "prev") {
        session.index = Math.max(0, session.index - 1);
      } else if (payload.direction === "next") {
        session.index = Math.min(session.tracks.length, session.index + 1);
      } else {
        return new Response("Invalid navigation direction.", { status: 400, headers: corsHeaders });
      }
      await updateWebSessionIndex(session.id, session.index, new Date().toISOString());
      return getSessionNext(session);
    }

    return null;
  }

  if (url.pathname.startsWith("/api/session/") && request.method === "DELETE") {
    const [, , , sessionId] = url.pathname.split("/");
    if (!sessionId) {
      return new Response("Session not found.", { status: 404, headers: corsHeaders });
    }
    await deleteWebSession(sessionId);
    sessions.delete(sessionId);
    return Response.json({ ok: true }, { headers: corsHeaders });
  }

  return null;
}
