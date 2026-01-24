import { parseMpdSegmentUrls } from "../manifest";
import { getTrackStreamUrl } from "../track";
import type { Track } from "../types";
import { sanitizeFilename } from "../filesystem";
import type { SearchTrackItem } from "../search";
import type { Session } from "./sessionRoutes";
import { getSessionById } from "./sessionRoutes";
import { corsHeaders } from "./cors";

const DEFAULT_DOWNLOAD_TEMPLATE = "{{trackNumber}} {{trackName}}.flac";
const ALLOWED_TEMPLATE_TOKENS = new Set([
  "trackNumber",
  "trackNumberPadded",
  "trackNumberRaw",
  "trackName",
  "safeTrackName",
  "artistName",
  "safeArtistName",
  "albumName",
  "safeAlbumName",
  "releaseYear",
  "year",
  "trackUri",
  "csvTrackNumber",
  "tidalTrackId",
  "tidalArtistName",
  "tidalAlbumName",
]);

type TemplateParseResult = {
  tokens: string[];
  hasUnmatched: boolean;
};

type TemplateValidation = {
  ok: boolean;
  error?: string;
};

function parseTemplateTokens(template: string): TemplateParseResult {
  const tokens: string[] = [];
  let index = 0;

  while (index < template.length) {
    const nextOpen = template.indexOf("{{", index);
    const nextClose = template.indexOf("}}", index);

    if (nextClose !== -1 && (nextOpen === -1 || nextClose < nextOpen)) {
      return { tokens, hasUnmatched: true };
    }

    if (nextOpen === -1) break;

    const closeIndex = template.indexOf("}}", nextOpen + 2);
    if (closeIndex === -1) {
      return { tokens, hasUnmatched: true };
    }

    const token = template.slice(nextOpen + 2, closeIndex).trim();
    if (token) {
      tokens.push(token);
    }
    index = closeIndex + 2;
  }

  return { tokens, hasUnmatched: false };
}

function validateTemplate(template: string): TemplateValidation {
  if (!template.trim()) {
    return { ok: false, error: "Template cannot be empty." };
  }

  const parsed = parseTemplateTokens(template);
  if (parsed.hasUnmatched) {
    return { ok: false, error: "Template has unmatched {{ }} braces." };
  }

  const invalidTokens = parsed.tokens.filter((token) => !ALLOWED_TEMPLATE_TOKENS.has(token));
  if (invalidTokens.length > 0) {
    return { ok: false, error: `Unsupported tokens: ${invalidTokens.join(", ")}` };
  }

  if (!template.toLowerCase().includes(".flac")) {
    return { ok: false, error: "Template must include a .flac extension." };
  }

  return { ok: true };
}

function ensureFlacExtension(filename: string): string {
  if (/\.flac$/i.test(filename)) {
    return filename;
  }
  return `${filename}.flac`;
}

function toAsciiFilename(filename: string): string {
  const normalized = filename.normalize("NFKD").replace(/[^\x20-\x7E]/g, "");
  const cleaned = normalized.replace(/["\\]/g, "_").trim();
  const fallback = cleaned || "download";
  return ensureFlacExtension(fallback);
}

function encodeContentDispositionFilename(filename: string): string {
  return encodeURIComponent(filename).replace(/[!'()*]/g, (char) =>
    `%${char.charCodeAt(0).toString(16).toUpperCase()}`
  );
}

function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, token: string) => context[token] ?? "");
}

function extractReleaseYear(releaseDate: string): string {
  if (!releaseDate) return "Unknown";
  const year = releaseDate.split("-")[0]?.trim();
  return year && /^\d{4}$/.test(year) ? year : "Unknown";
}

function buildDownloadName(track: Track, item: SearchTrackItem, template: string | null, csvIndex: number): string {
  const rawTrackNumber = item.trackNumber ? String(item.trackNumber) : "0";
  const paddedTrackNumber = item.trackNumber ? String(item.trackNumber).padStart(2, "0") : "00";
  const trackName = track.trackName || item.title || "Unknown Track";
  const artistName = track.artistName || item.artist.name || "Unknown Artist";
  const albumName = track.albumName || item.album.title || "Unknown Album";
  const releaseYear = extractReleaseYear(track.releaseDate);
  const csvTrackNumber = String(csvIndex + 1);
  const resolvedTemplate = template && template.trim() ? template.trim() : DEFAULT_DOWNLOAD_TEMPLATE;
  const rendered = renderTemplate(resolvedTemplate, {
    trackNumber: paddedTrackNumber,
    trackNumberPadded: paddedTrackNumber,
    trackNumberRaw: rawTrackNumber,
    trackName,
    safeTrackName: sanitizeFilename(trackName),
    artistName,
    safeArtistName: sanitizeFilename(artistName),
    albumName,
    safeAlbumName: sanitizeFilename(albumName),
    releaseYear,
    year: releaseYear,
    trackUri: track.trackUri || "",
    csvTrackNumber,
    tidalTrackId: String(item.id),
    tidalArtistName: item.artist.name || "",
    tidalAlbumName: item.album.title || "",
  });
  const sanitized = sanitizeFilename(rendered) || `${paddedTrackNumber} ${sanitizeFilename(trackName)}.flac`;
  return ensureFlacExtension(sanitized);
}

async function handleDownloadInfo(session: Session, trackIndex: number): Promise<Response> {
  const track = session.tracks[trackIndex];
  const selection = session.selections.get(trackIndex);
  if (!track || !selection || selection.kind !== "track") {
    return new Response("No track selection available.", { status: 400, headers: corsHeaders });
  }

  try {
    const stream = await getTrackStreamUrl(selection.item.id);
    if (!stream) {
      return new Response("Manifest payload not supported.", { status: 400, headers: corsHeaders });
    }

    return Response.json(
      {
        kind: stream.kind,
        requiresConversion: stream.kind === "mpd",
      },
      { headers: corsHeaders }
    );
  } catch (error) {
    console.error(`✗ Download info failed: ${error}`);
    return new Response("Download info failed.", { status: 500, headers: corsHeaders });
  }
}

async function handleDownloadManifest(session: Session, trackIndex: number): Promise<Response> {
  const track = session.tracks[trackIndex];
  const selection = session.selections.get(trackIndex);
  if (!track || !selection || selection.kind !== "track") {
    return new Response("No track selection available.", { status: 400, headers: corsHeaders });
  }

  try {
    const stream = await getTrackStreamUrl(selection.item.id);
    if (!stream) {
      return new Response("Manifest payload not supported.", { status: 400, headers: corsHeaders });
    }

    if (stream.kind === "url") {
      return Response.json({ kind: "url", url: stream.url }, { headers: corsHeaders });
    }

    const mpdText = Buffer.from(stream.buffer).toString("utf8");
    const segmentUrls = parseMpdSegmentUrls(mpdText);
    if (!segmentUrls) {
      return new Response("Unable to parse MPD manifest.", { status: 500, headers: corsHeaders });
    }

    return Response.json({ kind: "mpd", segments: segmentUrls }, { headers: corsHeaders });
  } catch (error) {
    console.error(`✗ Download manifest failed: ${error}`);
    return new Response("Download manifest failed.", { status: 500, headers: corsHeaders });
  }
}

async function handleDownload(session: Session, trackIndex: number, template: string | null): Promise<Response> {
  const track = session.tracks[trackIndex];
  const selection = session.selections.get(trackIndex);
  if (!track || !selection || selection.kind !== "track") {
    return new Response("No track selection available.", { status: 400, headers: corsHeaders });
  }

  if (template !== null) {
    const validation = validateTemplate(template);
    if (!validation.ok) {
      return new Response(validation.error ?? "Invalid download template.", { status: 400, headers: corsHeaders });
    }
  }

  const stream = await getTrackStreamUrl(selection.item.id);
  if (!stream) {
    return new Response("Manifest payload not supported.", { status: 400, headers: corsHeaders });
  }

  if (stream.kind === "mpd") {
    return new Response("Download requires conversion. Use the manifest endpoint.", {
      status: 400,
      headers: corsHeaders,
    });
  }

  const filename = buildDownloadName(track, selection.item, template, trackIndex);
  const asciiFilename = toAsciiFilename(filename);
  const encodedFilename = encodeContentDispositionFilename(filename);
  const headers = new Headers({
    ...corsHeaders,
    "Content-Disposition": `attachment; filename="${asciiFilename}"; filename*=UTF-8''${encodedFilename}`,
    "Content-Type": "audio/flac",
  });

  const response = await fetch(stream.url);
  if (!response.ok || !response.body) {
    return new Response("Failed to fetch audio stream.", { status: 502, headers: corsHeaders });
  }

  return new Response(response.body, { headers });
}

export async function handleDownloadRoutes(request: Request, url: URL): Promise<Response | null> {
  if (!url.pathname.startsWith("/api/session/") || request.method !== "GET") {
    return null;
  }

  const [, , , sessionId, action, param, subAction] = url.pathname.split("/");
  if (!sessionId || action !== "download" || !param) {
    return null;
  }

  const session = await getSessionById(sessionId);
  if (!session) {
    return new Response("Session not found.", { status: 404, headers: corsHeaders });
  }

  const index = Number(param);
  if (!Number.isFinite(index)) {
    return new Response("Invalid track index.", { status: 400, headers: corsHeaders });
  }

  if (subAction === "manifest") {
    return handleDownloadManifest(session, index);
  }

  if (subAction === "info") {
    return handleDownloadInfo(session, index);
  }

  if (!subAction) {
    const template = url.searchParams.get("template");
    return handleDownload(session, index, template);
  }

  return null;
}
