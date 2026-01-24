import { createWriteStream, constants } from "fs";
import { access, rename, unlink, writeFile } from "fs/promises";
import { spawn } from "child_process";
import { finished } from "stream/promises";
import { TRACK_API_BASE_URL, DEFAULT_AUDIO_QUALITY, DOWNLOADS_FOLDER } from "./config";
import { ensureDirectoryExists, sanitizeFilename } from "./filesystem";
import { decodeManifest, parseMpdSegmentUrls, type ManifestResult } from "./manifest";
import type { Track } from "./types";

type ManifestResponse = {
  version: string;
  data: {
    trackId: number;
    manifest: string;
  };
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
  const filename = `${prefix}. ${trackName}.flac`;
  const fullPath = `${directory}/${filename}`;

  return { directory, filename, fullPath };
}

export async function trackFileExists(track: Track, trackNumber?: number): Promise<boolean> {
  const { fullPath } = buildDownloadPath(track, trackNumber);
  return fileExists(fullPath);
}

type TrackMetadata = {
  title: string;
  artist: string;
  album: string;
  trackNumber?: number;
};

type DownloadOptions = {
  trackNumber?: number;
  metadata?: TrackMetadata;
  coverPath?: string | null;
};

function buildCoverUrl(coverId?: string | null): string | null {
  if (!coverId) {
    return null;
  }

  const normalized = coverId.replace(/-/g, "/");
  return `https://resources.tidal.com/images/${normalized}/1280x1280.jpg`;
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

function buildMetadataArgs(metadata: TrackMetadata): string[] {
  const args: string[] = [
    "-metadata",
    `title=${metadata.title}`,
    "-metadata",
    `artist=${metadata.artist}`,
    "-metadata",
    `album=${metadata.album}`,
  ];

  if (metadata.trackNumber && metadata.trackNumber > 0) {
    args.push("-metadata", `track=${metadata.trackNumber}`);
  }

  return args;
}

async function writeTaggedFlac(
  inputPath: string,
  outputPath: string,
  metadata: TrackMetadata,
  coverPath?: string | null,
): Promise<void> {
  const shouldIncludeCover = coverPath ? await fileExists(coverPath) : false;
  const args = ["ffmpeg", "-y", "-i", inputPath];

  if (shouldIncludeCover && coverPath) {
    args.push(
      "-i",
      coverPath,
      "-map",
      "0:a",
      "-map",
      "1:v",
      "-c:v",
      "mjpeg",
      "-disposition:v",
      "attached_pic",
      "-metadata:s:v",
      "title=Album cover",
      "-metadata:s:v",
      "comment=Cover (front)",
    );
  } else {
    args.push("-map", "0:a");
  }

  args.push("-c:a", "copy", ...buildMetadataArgs(metadata), outputPath);
  await runProcess(args);
}

export async function downloadTrackFile(
  track: Track,
  stream: ManifestResult,
  { trackNumber, metadata, coverPath }: DownloadOptions = {},
): Promise<void> {
  const { directory, fullPath } = buildDownloadPath(track, trackNumber);
  await ensureDirectoryExists(directory);

  const shouldTag = metadata !== undefined;

  if (stream.kind === "url") {
    const response = await fetch(stream.url);
    if (!response.ok) {
      throw new Error(`File download failed: ${response.status} ${response.statusText}`);
    }

    const buffer = await response.arrayBuffer();
    if (!shouldTag || !metadata) {
      await writeFile(fullPath, Buffer.from(buffer));
      console.log(`Saved: ${fullPath}`);
      return;
    }

    const tempPath = `${directory}/temp-${Date.now()}.flac`;
    await writeFile(tempPath, Buffer.from(buffer));
    try {
      await writeTaggedFlac(tempPath, fullPath, metadata, coverPath);
      console.log(`Saved: ${fullPath}`);
    } finally {
      await unlink(tempPath).catch(() => undefined);
    }
    return;
  }

  console.log("Using MPD manifest (manual segments)");
  const mpdPath = `${directory}/manifest.mpd`;
  await writeFile(mpdPath, Buffer.from(stream.buffer));
  const mpdText = Buffer.from(stream.buffer).toString("utf8");
  const segmentUrls = parseMpdSegmentUrls(mpdText);

  if (!segmentUrls) {
    throw new Error("MPD parsing failed; unable to derive segment URLs");
  }

  const segmentPath = `${directory}/segments.mp4`;
  const tempOutputPath = `${directory}/temp-${Date.now()}.flac`;
  let completed = false;

  try {
    const sink = createWriteStream(segmentPath);
    for (const url of [segmentUrls.initialization, ...segmentUrls.segments]) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Segment download failed: ${response.status} ${response.statusText}`);
      }

      const buffer = new Uint8Array(await response.arrayBuffer());
      sink.write(buffer);
    }
    sink.end();
    await finished(sink);

    await runProcess(["ffmpeg", "-y", "-i", segmentPath, "-c:a", "flac", tempOutputPath]);

    if (!shouldTag || !metadata) {
      await rename(tempOutputPath, fullPath);
      console.log(`Saved: ${fullPath}`);
      completed = true;
      return;
    }

    await writeTaggedFlac(tempOutputPath, fullPath, metadata, coverPath);
    await unlink(tempOutputPath).catch(() => undefined);
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

export async function downloadCoverArt(track: Track, coverId?: string | null): Promise<string | null> {
  const coverUrl = buildCoverUrl(coverId);
  if (!coverUrl) {
    return null;
  }

  const { directory } = buildDownloadPath(track);
  await ensureDirectoryExists(directory);

  const coverPath = `${directory}/cover.jpg`;
  try {
    await access(coverPath, constants.F_OK);
    return coverPath;
  } catch {
    // continue
  }

  const response = await fetch(coverUrl);
  if (!response.ok) {
    throw new Error(`Cover download failed: ${response.status} ${response.statusText}`);
  }

  const buffer = await response.arrayBuffer();
  await writeFile(coverPath, Buffer.from(buffer));
  console.log(`Saved: ${coverPath}`);
  return coverPath;
}

async function runProcess(args: string[]): Promise<void> {
  const [command, ...commandArgs] = args;
  await new Promise<void>((resolve, reject) => {
    const process = spawn(command ?? "", commandArgs, { stdio: "inherit" });
    process.on("error", (error) => reject(error));
    process.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`ffmpeg failed (${code ?? "unknown"})`));
      }
    });
  });
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}
