import { mkdir } from "fs/promises";

const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;

export function sanitizeFilename(value: string): string {
  return value.replace(INVALID_FILENAME_CHARS, "").replace(/\s+/g, " ").trim();
}

export async function ensureDirectoryExists(path: string): Promise<void> {
  await mkdir(path, { recursive: true });
}
