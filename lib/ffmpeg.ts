import { FFmpeg } from "@ffmpeg/ffmpeg";
import { toBlobURL } from "@ffmpeg/util";

let ffmpegPromise: Promise<FFmpeg> | null = null;
const CORE_VERSION = "0.12.10";
const CORE_BASE_URL = `https://unpkg.com/@ffmpeg/core@${CORE_VERSION}/dist/esm`;

type FfmpegProgress = {
  progress?: number;
  ratio?: number;
  time?: number;
};

type ProgressCallback = (progress: number | null) => void;

type FfmpegProgressEmitter = {
  on: (event: "progress", handler: (data: FfmpegProgress) => void) => void;
  off?: (event: "progress", handler: (data: FfmpegProgress) => void) => void;
};

async function loadFfmpeg(): Promise<FFmpeg> {
  if (!ffmpegPromise) {
    ffmpegPromise = (async () => {
      const ffmpeg = new FFmpeg();
      const coreBlobURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.js`, "text/javascript");
      const wasmBlobURL = await toBlobURL(`${CORE_BASE_URL}/ffmpeg-core.wasm`, "application/wasm");
      await ffmpeg.load({
        coreURL: coreBlobURL,
        wasmURL: wasmBlobURL,
      });
      return ffmpeg;
    })();
  }

  return ffmpegPromise;
}

function buildTempName(prefix: string, extension: string): string {
  const id = typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${id}.${extension}`;
}

function normalizeProgress(value?: number): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(Math.max(value, 0), 1);
}

export async function convertMp4ToFlac(input: Uint8Array, onProgress?: ProgressCallback): Promise<Uint8Array> {
  const ffmpeg = await loadFfmpeg();
  const ffmpegEmitter = ffmpeg as FfmpegProgressEmitter;
  const inputName = buildTempName("input", "mp4");
  const outputName = buildTempName("output", "flac");
  let progressHandler: ((data: FfmpegProgress) => void) | null = null;

  await ffmpeg.writeFile(inputName, input);

  if (onProgress) {
    onProgress(null);
    progressHandler = (data) => {
      const normalized = normalizeProgress(data.progress ?? data.ratio);
      if (normalized !== null) {
        onProgress(normalized);
      }
    };
    ffmpegEmitter.on("progress", progressHandler);
  }

  const args: string[] = ["-i", inputName, "-map", "0:a:0", "-c:a", "flac", outputName];

  try {
    await ffmpeg.exec(args);
  } finally {
    if (progressHandler && typeof ffmpegEmitter.off === "function") {
      ffmpegEmitter.off("progress", progressHandler);
    }
  }
  const output = (await ffmpeg.readFile(outputName)) as Uint8Array;

  try {
    await ffmpeg.deleteFile(inputName);
  } catch {
    // Ignore cleanup failures.
  }

  try {
    await ffmpeg.deleteFile(outputName);
  } catch {
    // Ignore cleanup failures.
  }

  return output;
}
