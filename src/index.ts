import { readCSVFile } from "./csv";
import { CSV_FILE_PATH } from "./config";
import { promptForSelection } from "./prompt";
import { getCachedDownload, recordDownload } from "./db";
import { searchTracks, type SearchTrackItem } from "./search";
import { downloadCoverArt, downloadTrackFile, getTrackStreamUrl } from "./track";
import type { Track } from "./types";

function normalize(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function buildTrackKey(artist: string, title: string, album: string): string {
  return [artist, title, album].map(normalize).join("|");
}

type SelectionResult =
  | { kind: "track"; item: SearchTrackItem }
  | { kind: "none" }
  | { kind: "skip" };

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

function formatOptionTrackNumber(trackNumber?: number): string {
  if (!trackNumber || trackNumber <= 0) {
    return "??";
  }

  return String(trackNumber).padStart(2, "0");
}

async function resolveTrackSelection(track: Track, items: SearchTrackItem[]): Promise<SelectionResult> {
  const deterministic = resolveDeterministicMatch(track, items);
  if (deterministic) {
    return { kind: "track", item: deterministic };
  }

  if (items.length === 0) {
    return { kind: "skip" };
  }

  const options = [
    { value: -1, label: "(none)" },
    ...items.map((item) => {
      const trackNumber = formatOptionTrackNumber(item.trackNumber);
      return {
        value: item.id,
        label: `${item.artist.name} - ${item.title} (${item.album.title}) [#${trackNumber}] [id: ${item.id}]`,
      };
    }),
  ];

  const header = `Spotify: ${track.artistName} - ${track.trackName} (${track.albumName})`;
  const selectedId = await promptForSelection(options, header);
  if (selectedId === null) {
    return { kind: "skip" };
  }

  if (selectedId === -1) {
    return { kind: "none" };
  }

  const selected = items.find((item) => item.id === selectedId);
  return selected ? { kind: "track", item: selected } : { kind: "skip" };
}

async function processTrack(track: Track): Promise<boolean> {
  const cacheKey = track.trackUri?.trim();
  if (cacheKey) {
    const cached = await getCachedDownload(cacheKey);
    if (cached) {
      console.log("⏭ Cached download found, skipping");
      return false;
    }
  }

  const query = `${track.artistName} - ${track.trackName}`.trim();
  console.log(`Searching: ${query}`);
  const items = await searchTracks(query);

  const selection = await resolveTrackSelection(track, items);
  if (selection.kind === "skip") {
    console.log("✗ No suitable match selected");
    return false;
  }

  if (selection.kind === "none") {
    if (cacheKey) {
      await recordDownload(cacheKey, null);
    }
    console.log("⏭ Marked as no match");
    return false;
  }

  const selected = selection.item;

  const streamResult = await getTrackStreamUrl(selected.id);
  if (!streamResult) {
    console.log("⚠️ Manifest returned unsupported payload (xml?)");
    return false;
  }

  await downloadTrackFile(track, streamResult, selected.trackNumber);

  if (cacheKey) {
    await recordDownload(cacheKey, selected.id);
  }

  try {
    await downloadCoverArt(track, selected.album.cover);
  } catch (error) {
    console.warn(`⚠️ Cover download failed: ${error}`);
  }

  return true;
}

async function main() {
  try {
    console.log(`Reading CSV file: ${CSV_FILE_PATH}`);
    const tracks = await readCSVFile(CSV_FILE_PATH);
    console.log(`Found ${tracks.length} tracks in CSV`);

    let downloaded = 0;
    let skipped = 0;
    let failed = 0;

    for (let i = 0; i < tracks.length; i++) {
      const track = tracks[i];
      if (!track) continue;

      console.log(`\n[${i + 1}/${tracks.length}] ${track.artistName} - ${track.trackName}`);

      try {
        const didDownload = await processTrack(track);
        if (didDownload) {
          downloaded++;
        } else {
          skipped++;
        }
      } catch (error) {
        failed++;
        console.error(`✗ Error: ${error}`);
        if (String(error).includes("ffmpeg failed")) {
          throw error;
        }
      }
    }

    console.log("\n=== Summary ===");
    console.log(`Total: ${tracks.length}`);
    console.log(`Downloaded: ${downloaded}`);
    console.log(`Skipped: ${skipped}`);
    console.log(`Failed: ${failed}`);
  } catch (error) {
    console.error("Error:", error);
    process.exitCode = 1;
  }
}

main();
