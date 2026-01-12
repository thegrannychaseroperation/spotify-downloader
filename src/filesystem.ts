import { mkdir } from "fs/promises";
import { readdir } from "fs/promises";
import type { Track } from "./types";
import { DOWNLOADS_FOLDER, AUDIO_EXTENSIONS } from "./config";

export function sanitizeFilename(filename: string): string {
  return filename
    .replace(/[<>:"/\\|?*]/g, "_")
    .replace(/\s+/g, " ")
    .trim();
}

export async function ensureDirectoryExists(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}

export function getAlbumFolderPath(track: Track): string | null {
  if (!track.artistName || !track.albumName || !track.releaseDate) {
    return null;
  }

  const yearMatch = track.releaseDate.match(/^(\d{4})/);
  if (!yearMatch || !yearMatch[1]) {
    return null;
  }

  const year = yearMatch[1];
  const sanitizedArtist = sanitizeFilename(track.artistName);
  const sanitizedAlbum = sanitizeFilename(track.albumName);

  return `${DOWNLOADS_FOLDER}/${sanitizedArtist}/${sanitizedAlbum} (${year})/`;
}

export async function isTrackAlreadyDownloaded(track: Track, albumFolderPath: string | null): Promise<boolean> {
  if (!albumFolderPath) {
    try {
      const files = await readdir(DOWNLOADS_FOLDER);
      const sanitizedTrackName = sanitizeFilename(track.trackName);
      return files.some(file => {
        const fileWithoutExt = file.replace(/\.[^.]+$/, "");
        return fileWithoutExt.includes(sanitizedTrackName) && AUDIO_EXTENSIONS.some(ext => file.endsWith(`.${ext}`));
      });
    } catch {
      return false;
    }
  }

  try {
    const files = await readdir(albumFolderPath);
    const sanitizedTrackName = sanitizeFilename(track.trackName);
    
    return files.some(file => {
      if (file === "cover.jpg") return false;
      
      const hasAudioExt = AUDIO_EXTENSIONS.some(ext => file.endsWith(`.${ext}`));
      if (!hasAudioExt) return false;
      
      const fileWithoutExt = file.replace(/\.[^.]+$/, "");
      return fileWithoutExt.includes(sanitizedTrackName) || sanitizedTrackName.includes(fileWithoutExt);
    });
  } catch {
    return false;
  }
}
