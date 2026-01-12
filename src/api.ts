import type { LoadResponse, PollResponse, Track } from "./types";
import { LUCIDA_API_URL, POLL_INTERVAL_MS, DOWNLOADS_FOLDER } from "./config";
import { ensureDirectoryExists, sanitizeFilename } from "./filesystem";

function getExtensionFromContentType(contentType: string | null): string {
  if (!contentType) return "bin";

  const mimeToExt: Record<string, string> = {
    "audio/flac": "flac",
    "audio/mpeg": "mp3",
    "audio/mp4": "m4a",
    "audio/aac": "aac",
    "audio/ogg": "ogg",
    "audio/wav": "wav",
    "audio/x-flac": "flac",
  };

  const mimeType = contentType.split(";")[0]?.trim() ?? "";
  return mimeToExt[mimeType] ?? "bin";
}

function getFilenameFromHeaders(
  headers: Headers,
  fallbackHandoff: string,
  track?: Track
): string {
  const contentDisposition = headers.get("Content-Disposition");

  if (contentDisposition) {
    const utf8Match = contentDisposition.match(/filename\*=UTF-8''([^;\n]*)/);
    if (utf8Match && utf8Match[1]) {
      try {
        const filename = decodeURIComponent(utf8Match[1].trim());
        if (filename && filename.length > 0) {
          return sanitizeFilename(filename);
        }
      } catch {
      }
    }

    const filenameMatch = contentDisposition.match(/filename[^;=\n]*=((['"]).*?\2|[^;\n]*)/);
    if (filenameMatch && filenameMatch[1]) {
      let filename = filenameMatch[1];

      if (filename.startsWith('"') && filename.endsWith('"')) {
        filename = filename.slice(1, -1);
      } else if (filename.startsWith("'") && filename.endsWith("'")) {
        filename = filename.slice(1, -1);
      }

      if (filename && filename.trim().length > 0) {
        return sanitizeFilename(filename.trim());
      }
    }
  }

  if (track) {
    const contentType = headers.get("Content-Type");
    const extension = getExtensionFromContentType(contentType);
    const artist = sanitizeFilename(track.artistName);
    const trackName = sanitizeFilename(track.trackName);
    return `${artist} - ${trackName}.${extension}`;
  }

  const contentType = headers.get("Content-Type");
  const extension = getExtensionFromContentType(contentType);
  return `${fallbackHandoff}.${extension}`;
}

export async function initiateDownload(tidalUrl: string, token: { primary: string; expiry: number }): Promise<{ handoff: string; server: string }> {
  console.log(`Initiating download for: ${tidalUrl}`);

  const response = await fetch(LUCIDA_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      url: tidalUrl,
      metadata: true,
      compat: false,
      private: false,
      handoff: true,
      account: {
        type: "country",
        id: "auto",
      },
      upload: {
        enabled: false,
        service: "pixeldrain",
      },
      downscale: "original",
      token: token,
    }),
  });

  if (!response.ok) {
    throw new Error(`Failed to initiate download: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as LoadResponse;

  if (!data.success) {
    throw new Error("API returned success: false");
  }

  console.log(`Download initiated on server: ${data.server}`);
  console.log(`Handoff ID: ${data.handoff}`);

  return { handoff: data.handoff, server: data.server };
}

export async function pollUntilCompleted(server: string, handoff: string): Promise<void> {
  const pollUrl = `https://${server}.lucida.to/api/fetch/request/${handoff}`;
  console.log(`Polling status at: ${pollUrl}`);

  while (true) {
    const response = await fetch(pollUrl);

    if (!response.ok) {
      throw new Error(`Failed to poll status: ${response.status} ${response.statusText}`);
    }

    const data = (await response.json()) as PollResponse;

    console.log(`Status: ${data.status} - ${data.message}`);

    if (data.status === "completed") {
      console.log("Download completed!");
      return;
    }

    await Bun.sleep(POLL_INTERVAL_MS);
  }
}

export async function downloadFile(server: string, handoff: string, albumFolderPath: string | null, track?: Track): Promise<void> {
  const downloadUrl = `https://${server}.lucida.to/api/fetch/request/${handoff}/download`;
  console.log(`Downloading from: ${downloadUrl}`);

  const response = await fetch(downloadUrl);

  if (!response.ok) {
    throw new Error(`Failed to download file: ${response.status} ${response.statusText}`);
  }

  const filename = getFilenameFromHeaders(response.headers, handoff, track);
  
  let fullPath: string;
  if (albumFolderPath) {
    await ensureDirectoryExists(albumFolderPath);
    fullPath = `${albumFolderPath}${filename}`;
  } else {
    await ensureDirectoryExists(DOWNLOADS_FOLDER);
    fullPath = `${DOWNLOADS_FOLDER}/${filename}`;
  }

  const arrayBuffer = await response.arrayBuffer();
  await Bun.write(fullPath, arrayBuffer);

  console.log(`File saved as: ${fullPath}`);
  console.log(`Size: ${(arrayBuffer.byteLength / 1024 / 1024).toFixed(2)} MB`);
}
