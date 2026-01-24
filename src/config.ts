export const CSV_FILE_PATH = "Liked_Songs.csv";
export const SEARCH_API_BASE_URL = "https://wolf.qqdl.site/search";
export const TRACK_API_BASE_URL = "https://triton.squid.wtf/track";
export const DOWNLOADS_FOLDER = "downloads";
export const DATABASE_URL =
  process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/striker";
export const DEFAULT_AUDIO_QUALITY = "HI_RES_LOSSLESS";
export const OLLAMA_BASE_URL = process.env.OLLAMA_BASE_URL ?? "http://localhost:11434/v1";
export const OLLAMA_MODEL = process.env.OLLAMA_MODEL ?? "gpt-oss:20b";
export const OLLAMA_API_KEY = process.env.OLLAMA_API_KEY ?? "ollama";

const envMatchThreshold = Number(process.env.MATCH_CONFIDENCE_THRESHOLD ?? "");
export const MATCH_CONFIDENCE_THRESHOLD = Number.isFinite(envMatchThreshold) ? envMatchThreshold : 0.75;

const envCandidateLimit = Number(process.env.MATCH_CANDIDATE_LIMIT ?? "");
export const MATCH_CANDIDATE_LIMIT =
  Number.isFinite(envCandidateLimit) && envCandidateLimit > 0 ? envCandidateLimit : 5;
