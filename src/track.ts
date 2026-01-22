import { unlink } from "fs/promises";
import { TRACK_API_BASE_URL, DEFAULT_AUDIO_QUALITY, DOWNLOADS_FOLDER } from "./config";
import { ensureDirectoryExists, sanitizeFilename } from "./filesystem";
import type { Track } from "./types";

type ManifestResponse = {
  version: string;
  data: {
    trackId: number;
    manifest: string;
  };
};

type ManifestPayload = {
  mimeType: string;
  codecs: string;
  encryptionType: string;
  urls: string[];
};

type ManifestResult =
  | { kind: "url"; url: string }
  | { kind: "mpd"; buffer: Uint8Array };

type SegmentTemplate = {
  initialization: string;
  media: string;
  startNumber: number;
  timeline: Array<{ d: number; r: number }>;
};

function extractReleaseYear(releaseDate: string): string {
  if (!releaseDate) return "Unknown";
  const year = releaseDate.split("-")[0]?.trim();
  return year && /^\d{4}$/.test(year) ? year : "Unknown";
}

function formatTrackNumber(trackNumber?: number): string {
  if (!trackNumber || trackNumber <= 0) {
    return "00";
  }

  return String(trackNumber).padStart(2, "0");
}

function buildDownloadPath(track: Track, trackNumber?: number): { directory: string; filename: string; fullPath: string } {
  const artist = sanitizeFilename(track.artistName || "Unknown Artist");
  const album = sanitizeFilename(track.albumName || "Unknown Album");
  const trackName = sanitizeFilename(track.trackName || "Unknown Track");
  const year = extractReleaseYear(track.releaseDate);

  const directory = `${DOWNLOADS_FOLDER}/${artist}/${album} (${year})`;
  const prefix = formatTrackNumber(trackNumber);
  const filename = `${prefix} ${trackName}.flac`;
  const fullPath = `${directory}/${filename}`;

  return { directory, filename, fullPath };
}

function buildCoverUrl(coverId?: string | null): string | null {
  if (!coverId) {
    return null;
  }

  const normalized = coverId.replace(/-/g, "/");
  return `https://resources.tidal.com/images/${normalized}/1280x1280.jpg`;
}

function decodeManifest(manifest: string): ManifestResult | null {
  const decodedBuffer = Buffer.from(manifest, "base64");
  const decodedText = decodedBuffer.toString("utf8").trim();
  if (decodedText.startsWith("<")) {
    return { kind: "mpd", buffer: decodedBuffer };
  }

  try {
    const payload = JSON.parse(decodedText) as ManifestPayload;
    const url = payload.urls?.[0];
    if (!url) {
      return null;
    }

    return { kind: "url", url };
  } catch {
    return null;
  }
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source))) {
    const key = match[1];
    if (key) {
      attributes[key] = match[2] ?? "";
    }
  }

  return attributes;
}

function parseSegmentTemplate(xml: string): SegmentTemplate | null {
  const templateMatch = xml.match(/<SegmentTemplate\s+([^>]+)>/);
  if (!templateMatch?.[1]) {
    return null;
  }

  const templateAttributes = parseAttributes(templateMatch[1]);
  const initialization = templateAttributes.initialization;
  const media = templateAttributes.media;
  const startNumber = Number(templateAttributes.startNumber ?? "1");

  if (!initialization || !media) {
    return null;
  }

  const timelineMatch = xml.match(/<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/);
  if (!timelineMatch?.[1]) {
    return null;
  }

  const timeline: Array<{ d: number; r: number }> = [];
  for (const match of timelineMatch[1].matchAll(/<S\s+([^/>]+)\/?\s*>/g)) {
    if (!match[1]) continue;
    const attrs = parseAttributes(match[1]);
    const d = Number(attrs.d ?? "0");
    const r = Number(attrs.r ?? "0");
    if (!Number.isFinite(d) || d <= 0) continue;
    timeline.push({ d, r: Number.isFinite(r) ? r : 0 });
  }

  if (timeline.length === 0) {
    return null;
  }

  return {
    initialization,
    media,
    startNumber: Number.isFinite(startNumber) && startNumber > 0 ? startNumber : 1,
    timeline,
  };
}

function buildSegmentUrls(template: SegmentTemplate): { initialization: string; segments: string[] } | null {
  if (!template.media.includes("$Number$")) {
    return null;
  }

  const segments: string[] = [];
  let currentNumber = template.startNumber;

  for (const entry of template.timeline) {
    const repeat = entry.r >= 0 ? entry.r + 1 : 1;
    for (let i = 0; i < repeat; i++) {
      segments.push(template.media.replace("$Number$", String(currentNumber)));
      currentNumber++;
    }
  }

  return {
    initialization: template.initialization,
    segments,
  };
}

export async function getTrackStreamUrl(trackId: number, quality: string = DEFAULT_AUDIO_QUALITY): Promise<ManifestResult | null> {
  const url = `${TRACK_API_BASE_URL}/?id=${trackId}&quality=${encodeURIComponent(quality)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Track request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as ManifestResponse;
  return decodeManifest(data.data.manifest);
}

export async function downloadTrackFile(track: Track, stream: ManifestResult, trackNumber?: number): Promise<void> {
  const { directory, fullPath } = buildDownloadPath(track, trackNumber);
  await ensureDirectoryExists(directory);

  if (stream.kind === "url") {
    const response = await fetch(stream.url);
    if (!response.ok) {
      throw new Error(`File download failed: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    await Bun.write(fullPath, buffer);
    console.log(`Saved: ${fullPath}`);
    return;
  }

  console.log("Using MPD manifest (manual segments)");
  const mpdPath = `${directory}/manifest.mpd`;
  await Bun.write(mpdPath, stream.buffer);
  const mpdText = Buffer.from(stream.buffer).toString("utf8");
  const segmentTemplate = parseSegmentTemplate(mpdText);
  const segmentUrls = segmentTemplate ? buildSegmentUrls(segmentTemplate) : null;

  if (!segmentUrls) {
    throw new Error("MPD parsing failed; unable to derive segment URLs");
  }

  const segmentPath = `${directory}/segments.mp4`;
  let completed = false;

  try {
    const sink = Bun.file(segmentPath).writer();
    for (const url of [segmentUrls.initialization, ...segmentUrls.segments]) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Segment download failed: ${response.status} ${response.statusText}`);
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      sink.write(buffer);
    }
    await sink.end();

    const process = Bun.spawn(
      [
        "ffmpeg",
        "-y",
        "-i",
        segmentPath,
        "-c:a",
        "flac",
        fullPath,
      ],
      {
        stdout: "inherit",
        stderr: "inherit",
      }
    );
    const exitCode = await process.exited;

    if (exitCode !== 0) {
      throw new Error(`ffmpeg failed (${exitCode})`);
    }

    console.log(`Saved: ${fullPath}`);
    completed = true;
  } finally {
    if (completed) {
      await unlink(mpdPath).catch(() => undefined);
      await unlink(segmentPath).catch(() => undefined);
    } else {
      console.warn(`⚠️ Keeping MPD for inspection: ${mpdPath}`);
      console.warn(`⚠️ Keeping segments for inspection: ${segmentPath}`);
    }
  }
}

export async function downloadCoverArt(track: Track, coverId?: string | null): Promise<void> {
  const coverUrl = buildCoverUrl(coverId);
  if (!coverUrl) {
    return;
  }

  const { directory } = buildDownloadPath(track);
  await ensureDirectoryExists(directory);

  const response = await fetch(coverUrl);
  if (!response.ok) {
    throw new Error(`Cover download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  const coverPath = `${directory}/cover.jpg`;
  await Bun.write(coverPath, buffer);
  console.log(`Saved: ${coverPath}`);
}
