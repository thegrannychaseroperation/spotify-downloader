"use client";

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import { BlobReader, BlobWriter, ZipWriter } from "@zip.js/zip.js";
import { List } from "react-window";
import { useRouter, useSearchParams } from "next/navigation";
import { Button, buttonVariants } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import { Checkbox } from "./ui/checkbox";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "./ui/dialog";
import { Input } from "./ui/input";
import { RadioGroup, RadioGroupItem } from "./ui/radio-group";
import { Toast } from "./ui/toaster";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "./ui/tooltip";
import type {
  MatchResponse,
  SearchTrackItem,
  SessionResponse,
  SessionSummary,
  Track,
  TrackListEntry,
  TrackListResponse,
} from "../lib/types";
import { convertMp4ToFlac } from "../lib/ffmpeg";
import { applyFlacTags } from "../lib/flacTags";
import type { FlacPicture, FlacTagMetadata } from "../lib/flacTags";
import { cn } from "../lib/utils";

type DownloadEntry = {
  index: number;
  track: Track;
  item: SearchTrackItem;
};

type DownloadInfoResponse = {
  kind: "url" | "mpd";
  requiresConversion: boolean;
};

type DownloadManifestResponse =
  | { kind: "url"; url: string }
  | { kind: "mpd"; segments: { initialization: string; segments: string[] } };

type CoverPayload = {
  buffer: Uint8Array;
  mimeType: string;
  extension: "jpg" | "jpeg" | "png";
};

type DownloadRowData = {
  entries: DownloadEntry[];
  buildDownloadKey: (index: number, itemId: number) => string;
  downloadStatus: Record<string, "checking" | "converting">;
  isLoading: boolean;
  onOpenMatch: (entry: DownloadEntry) => void;
  onDownload: (entry: DownloadEntry) => void;
  onRemove: (index: number, itemId: number) => void;
};

type FfmpegToastState = {
  open: boolean;
  title: string;
  description: string | null;
  progress: number | null;
};

type ZipToastState = {
  open: boolean;
  title: string;
  description: string | null;
  progress: number | null;
};

type AutoSizerSize = {
  height: number;
  width: number;
};

const buildApiUrl = (path: string) => path;
const buildTidalUrl = (trackId: number) => `https://tidal.com/browse/track/${trackId}`;
const buildCoverProxyUrl = (coverUrl: string) => {
  const params = new URLSearchParams({ url: coverUrl });
  return buildApiUrl(`/api/cover?${params.toString()}`);
};
const buildSpotifyUrl = (trackUri: string) => {
  if (!trackUri) return "";
  if (trackUri.startsWith("https://open.spotify.com/track/")) return trackUri;
  if (trackUri.startsWith("spotify:track:")) {
    const trackId = trackUri.split(":")[2];
    return trackId ? `https://open.spotify.com/track/${trackId}` : "";
  }
  return "";
};
const createDownloadKey = (index: number, itemId: number) => `${index}-${itemId}`;

const STORAGE_PREFIX = "striker";
const ACTIVE_SESSION_KEY = `${STORAGE_PREFIX}:activeSessionId`;
const SESSIONS_KEY = `${STORAGE_PREFIX}:sessions`;
const DOWNLOAD_TEMPLATE_KEY = `${STORAGE_PREFIX}:downloadTemplate`;
const SINGLE_DOWNLOAD_TEMPLATE_KEY = `${STORAGE_PREFIX}:singleDownloadTemplate`;
const ZIP_DOWNLOAD_TEMPLATE_KEY = `${STORAGE_PREFIX}:zipDownloadTemplate`;
const INCLUDE_ALBUM_COVER_KEY = `${STORAGE_PREFIX}:includeAlbumCover`;
const DEFAULT_SINGLE_DOWNLOAD_TEMPLATE = "{{artistName}} - {{trackName}}.flac";
const DEFAULT_ZIP_DOWNLOAD_TEMPLATE = "{{safeArtistName}}/{{safeAlbumName}} ({{releaseYear}})/{{trackNumber}}. {{safeTrackName}}.flac";
const DEFAULT_ZIP_NAME = "striker-downloads";

type TemplateToken = {
  token: string;
  label: string;
  description: string;
  example: string;
};

type TemplateParseResult = {
  tokens: string[];
  hasUnmatched: boolean;
};

type TemplateValidation = {
  ok: boolean;
  message: string | null;
  tokens: string[];
};

const TEMPLATE_TOKENS: TemplateToken[] = [
  {
    token: "trackNumber",
    label: "Track number",
    description: "Zero-padded track number from the matched catalog.",
    example: "03",
  },
  {
    token: "trackNumberPadded",
    label: "Track number padded",
    description: "Alias of trackNumber (zero-padded).",
    example: "03",
  },
  {
    token: "trackNumberRaw",
    label: "Track number raw",
    description: "Track number without zero padding.",
    example: "3",
  },
  {
    token: "trackName",
    label: "Track name",
    description: "Title of the track from your CSV or match selection.",
    example: "Midnight City",
  },
  {
    token: "safeTrackName",
    label: "Safe track name",
    description: "Track name sanitized for filenames.",
    example: "Midnight City",
  },
  {
    token: "artistName",
    label: "Artist name",
    description: "Primary artist from your CSV or match selection.",
    example: "M83",
  },
  {
    token: "safeArtistName",
    label: "Safe artist name",
    description: "Artist name sanitized for filenames.",
    example: "M83",
  },
  {
    token: "albumName",
    label: "Album name",
    description: "Album title from the match selection.",
    example: "Hurry Up, We're Dreaming",
  },
  {
    token: "safeAlbumName",
    label: "Safe album name",
    description: "Album name sanitized for filenames.",
    example: "Hurry Up, Were Dreaming",
  },
  {
    token: "releaseYear",
    label: "Release year",
    description: "Year parsed from the release date in your CSV.",
    example: "2011",
  },
  {
    token: "csvTrackNumber",
    label: "CSV track number",
    description: "1-based position of the track inside the CSV playlist.",
    example: "42",
  },
  {
    token: "year",
    label: "Year",
    description: "Alias of releaseYear.",
    example: "2011",
  },
  {
    token: "trackUri",
    label: "Track URI",
    description: "Spotify track URI from the CSV.",
    example: "spotify:track:1ZMiCix7XSAbfAJlEZWMCp",
  },
  {
    token: "tidalTrackId",
    label: "Tidal track ID",
    description: "Matched Tidal track ID.",
    example: "12345678",
  },
  {
    token: "tidalArtistName",
    label: "Tidal artist name",
    description: "Artist name from the matched Tidal result.",
    example: "M83",
  },
  {
    token: "tidalAlbumName",
    label: "Tidal album name",
    description: "Album title from the matched Tidal result.",
    example: "Hurry Up, We're Dreaming",
  },
];

const TEMPLATE_TOKEN_SET = new Set(TEMPLATE_TOKENS.map((token) => token.token));
const INVALID_FILENAME_CHARS = /[<>:"/\\|?*\x00-\x1F]/g;
const INVALID_PATH_CHARS = /[<>:"\\|?*\x00-\x1F]/;
const SAMPLE_TEMPLATE_CONTEXT = {
  trackNumber: "01",
  trackNumberPadded: "01",
  trackNumberRaw: "1",
  trackName: "Sample Track",
  safeTrackName: "Sample Track",
  artistName: "Sample Artist",
  safeArtistName: "Sample Artist",
  albumName: "Sample Album",
  safeAlbumName: "Sample Album",
  releaseYear: "2024",
  csvTrackNumber: "12",
  year: "2024",
  trackUri: "spotify:track:1ZMiCix7XSAbfAJlEZWMCp",
  tidalTrackId: "12345678",
  tidalArtistName: "Sample Artist",
  tidalAlbumName: "Sample Album",
};

function sanitizeFilename(value: string): string {
  return value.replace(INVALID_FILENAME_CHARS, "").replace(/\s+/g, " ").trim();
}

function sanitizeZipPath(value: string): string {
  const segments = value
    .split("/")
    .map((segment) => sanitizeFilename(segment))
    .filter(Boolean);
  return segments.join("/");
}

function buildZipFilename(sessionName: string | null): string {
  const base = sessionName ? sessionName.replace(/\.csv$/i, "") : DEFAULT_ZIP_NAME;
  const sanitized = sanitizeFilename(base);
  const finalName = sanitized || DEFAULT_ZIP_NAME;
  return `${finalName}.zip`;
}

function ensureFlacPath(path: string): string {
  if (!path) return path;
  const segments = path.split("/");
  const filename = segments.pop() ?? "";
  const resolvedFilename = ensureFlacExtension(filename);
  return [...segments, resolvedFilename].filter(Boolean).join("/");
}

function buildZipEntryPath(entry: DownloadEntry, template: string): string {
  const context = buildTemplateContext(entry.track, entry.item, entry.index);
  const renderPath = (templateValue: string) => {
    const rendered = renderTemplate(templateValue, context);
    const sanitized = sanitizeZipPath(rendered);
    return ensureFlacPath(sanitized);
  };
  const resolvedTemplate = validateDownloadTemplate(template).ok ? template : DEFAULT_ZIP_DOWNLOAD_TEMPLATE;
  const candidate = renderPath(resolvedTemplate);
  if (candidate) return candidate;
  return renderPath(DEFAULT_ZIP_DOWNLOAD_TEMPLATE) || "track.flac";
}

function buildAlbumCoverPath(zipEntryPath: string): string | null {
  if (!zipEntryPath) return null;
  const segments = zipEntryPath.split("/");
  if (segments.length <= 1) return null;
  const folderPath = segments.slice(0, -1).join("/");
  return folderPath ? `${folderPath}/cover.jpg` : null;
}

function buildFlacMetadata(entry: DownloadEntry): FlacTagMetadata {
  const title = entry.track.trackName || entry.item.title || "Unknown Track";
  const artist = entry.track.artistName || entry.item.artist?.name || "Unknown Artist";
  const album = entry.track.albumName || entry.item.album?.title || "Unknown Album";
  const date = extractReleaseYear(entry.track.releaseDate);
  const trackNumber = entry.item.trackNumber ?? entry.index + 1;
  const trackNumberTag = trackNumber && trackNumber > 0 ? String(trackNumber) : undefined;

  return {
    title,
    artist,
    album,
    date,
    trackNumber: trackNumberTag,
  };
}

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

function validateDownloadTemplate(template: string): TemplateValidation {
  if (!template.trim()) {
    return { ok: false, message: "Template cannot be empty.", tokens: [] };
  }

  const parsed = parseTemplateTokens(template);
  if (parsed.hasUnmatched) {
    return { ok: false, message: "Template has unmatched {{ }} braces.", tokens: parsed.tokens };
  }

  if (template.split("/").some((segment) => INVALID_PATH_CHARS.test(segment))) {
    return { ok: false, message: "Template contains invalid characters.", tokens: parsed.tokens };
  }

  const invalidTokens = parsed.tokens.filter((token) => !TEMPLATE_TOKEN_SET.has(token));
  if (invalidTokens.length > 0) {
    return {
      ok: false,
      message: `Unsupported tokens: ${invalidTokens.join(", ")}`,
      tokens: parsed.tokens,
    };
  }

  if (!template.toLowerCase().includes(".flac")) {
    return { ok: false, message: "Template must include a .flac extension.", tokens: parsed.tokens };
  }

  return { ok: true, message: null, tokens: parsed.tokens };
}

function renderTemplate(template: string, context: Record<string, string>): string {
  return template.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_, token: string) => context[token] ?? "");
}

function ensureFlacExtension(filename: string): string {
  if (/\.flac$/i.test(filename)) {
    return filename;
  }
  return `${filename}.flac`;
}

function formatTrackNumber(trackNumber?: number): string {
  if (!trackNumber || trackNumber <= 0) {
    return "00";
  }

  return String(trackNumber).padStart(2, "0");
}

function extractReleaseYear(releaseDate: string): string {
  if (!releaseDate) return "Unknown";
  const year = releaseDate.split("-")[0]?.trim();
  return year && /^\d{4}$/.test(year) ? year : "Unknown";
}

function buildTemplateContext(track: Track | null, item: SearchTrackItem | null, csvIndex: number | null) {
  if (!track) {
    return SAMPLE_TEMPLATE_CONTEXT;
  }

  const rawTrackNumber = item?.trackNumber ? String(item.trackNumber) : "0";
  const paddedTrackNumber = formatTrackNumber(item?.trackNumber);
  const trackName = track.trackName || item?.title || "Unknown Track";
  const artistName = track.artistName || item?.artist?.name || "Unknown Artist";
  const albumName = track.albumName || item?.album?.title || "Unknown Album";
  const tidalAlbumName = item?.album?.title || "Unknown Album";
  const tidalArtistName = item?.artist?.name || "Unknown Artist";
  const releaseYear = extractReleaseYear(track.releaseDate);
  const csvTrackNumber = csvIndex !== null ? String(csvIndex + 1) : "";

  return {
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
    csvTrackNumber,
    year: releaseYear,
    trackUri: track.trackUri || "",
    tidalTrackId: item?.id ? String(item.id) : "",
    tidalArtistName,
    tidalAlbumName,
  };
}

const DOWNLOAD_ROW_HEIGHT = 88;
type DownloadRowProps = {
  data: DownloadRowData;
};

type VirtualListRowProps = DownloadRowProps & {
  ariaAttributes: {
    "aria-posinset": number;
    "aria-setsize": number;
    role: "listitem";
  };
  index: number;
  style: CSSProperties;
};

const AutoSizer = ({ children, className }: { children: (size: AutoSizerSize) => ReactNode; className?: string }) => {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [size, setSize] = useState<AutoSizerSize>({ height: 0, width: 0 });

  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const element = containerRef.current;
    const updateSize = () => {
      const { height, width } = element.getBoundingClientRect();
      setSize({ height, width });
    };

    updateSize();

    if (typeof ResizeObserver !== "undefined") {
      const observer = new ResizeObserver(() => updateSize());
      observer.observe(element);
      return () => observer.disconnect();
    }

    window.addEventListener("resize", updateSize);
    return () => window.removeEventListener("resize", updateSize);
  }, []);

  return (
    <div ref={containerRef} className={cn("flex-1 min-h-0", className)}>
      {size.height > 0 && size.width > 0 && children(size)}
    </div>
  );
};

type DownloadRowCardProps = {
  entry: DownloadEntry;
  downloadStatus: Record<string, "checking" | "converting">;
  buildDownloadKey: (index: number, itemId: number) => string;
  isLoading: boolean;
  onOpenMatch: (entry: DownloadEntry) => void;
  onDownload: (entry: DownloadEntry) => void;
  onRemove: (index: number, itemId: number) => void;
};

const DownloadRowCard = ({ entry, buildDownloadKey, downloadStatus, isLoading, onOpenMatch, onDownload, onRemove }: DownloadRowCardProps) => {
  const entryKey = buildDownloadKey(entry.index, entry.item.id);
  const entryStatus = downloadStatus[entryKey] ?? null;
  const isEntryBusy = Boolean(entryStatus);
  const isEntryConverting = entryStatus === "converting";
  const isEntryChecking = entryStatus === "checking";
  const downloadTitle = entry.item.title || entry.track.trackName || "Unknown Track";
  const downloadArtist = entry.item.artist?.name || entry.track.artistName || "Unknown Artist";
  const downloadAlbum = entry.item.album?.title || entry.track.albumName || "Unknown Album";

  return (
    <div className="download-item-enter flex min-w-0 items-center justify-between gap-5 rounded-lg border border-white/10 bg-zinc-950 px-4 py-3">
      <button
        type="button"
        onClick={() => onOpenMatch(entry)}
        className="-m-2 flex min-w-0 flex-1 items-center gap-3 rounded-md p-2 text-left transition hover:bg-white/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/20 disabled:cursor-not-allowed disabled:opacity-60"
        aria-label={`View ${downloadTitle} matches`}
        disabled={isLoading}
      >
        <div className="size-12 shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/5">
          {entry.item.album.cover ? (
            <img
              src={entry.item.album.cover}
              alt={`${entry.item.album.title} cover`}
              loading="eager"
              decoding="async"
              className="size-full object-cover"
            />
          ) : (
            <div className="flex size-full items-center justify-center text-[10px] text-white/40">No art</div>
          )}
        </div>
        <div className="flex min-w-0 flex-col">
          <p className="text-sm font-medium truncate">{downloadTitle}</p>
          <p className="text-xs text-white/60 truncate">
            {downloadArtist} · {downloadAlbum}
          </p>
        </div>
      </button>
      <div className="flex shrink-0 items-center gap-2">
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              className={cn(buttonVariants({ size: "sm" }), "h-8 w-8 shrink-0 px-0")}
              onClick={() => onDownload(entry)}
              aria-label={`Download ${downloadTitle}`}
              disabled={isEntryBusy}
              type="button"
            >
              {isEntryBusy ? (
                <span className="size-4 animate-spin rounded-full border-2 border-black/30 border-t-black" aria-hidden="true" />
              ) : (
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="h-4 w-4"
                  aria-hidden="true"
                >
                  <path d="M12 3v12" />
                  <path d="M7 10l5 5 5-5" />
                  <path d="M5 21h14" />
                </svg>
              )}
            </button>
          </TooltipTrigger>
          <TooltipContent>{isEntryConverting ? "Converting" : isEntryChecking ? "Preparing download" : "Download"}</TooltipContent>
        </Tooltip>
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 w-8 px-0 text-white/70 hover:text-white"
              onClick={() => onRemove(entry.index, entry.item.id)}
              aria-label={`Remove ${downloadTitle} from downloads`}
            >
              ×
            </Button>
          </TooltipTrigger>
          <TooltipContent>Remove</TooltipContent>
        </Tooltip>
      </div>
    </div>
  );
};

const DownloadRow = ({ ariaAttributes, index, style, data }: VirtualListRowProps) => {
  const { entries, buildDownloadKey, downloadStatus, isLoading, onOpenMatch, onDownload, onRemove } = data;
  const entry = entries[index];

  if (!entry) return null;

  return (
    <div style={style} className="px-1 py-1" {...ariaAttributes}>
      <DownloadRowCard
        entry={entry}
        buildDownloadKey={buildDownloadKey}
        downloadStatus={downloadStatus}
        isLoading={isLoading}
        onOpenMatch={onOpenMatch}
        onDownload={onDownload}
        onRemove={onRemove}
      />
    </div>
  );
};

DownloadRow.displayName = "DownloadRow";

const EMPTY_MATCH: MatchResponse = {
  done: false,
  index: 0,
  total: 0,
  track: null,
  results: [] as SearchTrackItem[],
  suggestedId: null,
};

type AppClientProps = {
  initialSessions: SessionSummary[];
  initialSessionId?: string | null;
  initialMatch?: MatchResponse | null;
  initialDownloads?: DownloadEntry[];
};

const normalizeMatchResponse = (data: MatchResponse): MatchResponse => ({
  ...data,
  results: Array.isArray(data.results) ? data.results : [],
});

function resolveInitialSelectedId(match: MatchResponse | null, initialDownloads: DownloadEntry[] | null): string {
  if (!match?.track) return "";
  const savedEntry = initialDownloads?.find((entry) => entry.index === match.index);
  if (savedEntry) {
    const hasMatch = match.results.some((item) => item.id === savedEntry.item.id);
    if (hasMatch) return String(savedEntry.item.id);
  }
  return match.suggestedId ? String(match.suggestedId) : "";
}

function AppClient({ initialSessions, initialSessionId, initialMatch, initialDownloads }: AppClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [sessionId, setSessionId] = useState<string | null>(() => initialSessionId ?? null);
  const [match, setMatch] = useState<MatchResponse>(() => initialMatch ?? EMPTY_MATCH);
  const [selectedId, setSelectedId] = useState<string>(() => resolveInitialSelectedId(initialMatch ?? null, initialDownloads ?? null));
  const [status, setStatus] = useState("idle");
  const [error, setError] = useState<string | null>(null);
  const [downloads, setDownloads] = useState<DownloadEntry[]>(() => initialDownloads ?? []);
  const [downloadSearch, setDownloadSearch] = useState("");
  const [downloadStatus, setDownloadStatus] = useState<Record<string, "checking" | "converting">>({});
  const [ffmpegToast, setFfmpegToast] = useState<FfmpegToastState>({
    open: false,
    title: "",
    description: null,
    progress: null,
  });
  const [zipToast, setZipToast] = useState<ZipToastState>({
    open: false,
    title: "",
    description: null,
    progress: null,
  });
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [tokenDialogOpen, setTokenDialogOpen] = useState(false);
  const [downloadOrder, setDownloadOrder] = useState<string[]>(() =>
    initialDownloads ? initialDownloads.map((entry) => createDownloadKey(entry.index, entry.item.id)) : []
  );
  const [zipDownloading, setZipDownloading] = useState(false);
  const [zipCancelOpen, setZipCancelOpen] = useState(false);
  const [zipCancelRequested, setZipCancelRequested] = useState(false);
  const [singleDownloadTemplate, setSingleDownloadTemplate] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_SINGLE_DOWNLOAD_TEMPLATE;
    const storedSingle = localStorage.getItem(SINGLE_DOWNLOAD_TEMPLATE_KEY);
    if (storedSingle && storedSingle.trim()) return storedSingle;
    const storedLegacy = localStorage.getItem(DOWNLOAD_TEMPLATE_KEY);
    return storedLegacy && storedLegacy.trim() ? storedLegacy : DEFAULT_SINGLE_DOWNLOAD_TEMPLATE;
  });
  const [zipDownloadTemplate, setZipDownloadTemplate] = useState(() => {
    if (typeof window === "undefined") return DEFAULT_ZIP_DOWNLOAD_TEMPLATE;
    const storedZip = localStorage.getItem(ZIP_DOWNLOAD_TEMPLATE_KEY);
    if (storedZip && storedZip.trim()) return storedZip;
    const storedLegacy = localStorage.getItem(DOWNLOAD_TEMPLATE_KEY);
    return storedLegacy && storedLegacy.trim() ? storedLegacy : DEFAULT_ZIP_DOWNLOAD_TEMPLATE;
  });
  const [includeAlbumCover, setIncludeAlbumCover] = useState(() => {
    if (typeof window === "undefined") return true;
    const stored = localStorage.getItem(INCLUDE_ALBUM_COVER_KEY);
    return stored ? stored === "true" : true;
  });
  const [singleTemplateDraft, setSingleTemplateDraft] = useState(() => singleDownloadTemplate);
  const [zipTemplateDraft, setZipTemplateDraft] = useState(() => zipDownloadTemplate);
  const [includeAlbumCoverDraft, setIncludeAlbumCoverDraft] = useState(() => includeAlbumCover);
  const [autoQueueing, setAutoQueueing] = useState(false);
  const [autoQueueProgress, setAutoQueueProgress] = useState<{ index: number; total: number } | null>(null);
  const [trackList, setTrackList] = useState<TrackListEntry[] | null>(null);
  const [trackListOpen, setTrackListOpen] = useState(false);
  const [trackListLoading, setTrackListLoading] = useState(false);
  const [trackListError, setTrackListError] = useState<string | null>(null);
  const [trackListSearch, setTrackListSearch] = useState("");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(() => initialSessionId ?? null);
  const [sessions, setSessions] = useState<SessionSummary[]>(() => initialSessions);
  const autoQueueingRef = useRef(false);
  const autoQueueRunning = useRef(false);
  const lastAutoMatchedIndex = useRef<number | null>(null);
  const stopAutoQueueIndexRef = useRef<number | null>(null);
  const autoQueueOriginIndexRef = useRef<number | null>(null);
  const downloadsRef = useRef<DownloadEntry[]>([]);
  const downloadOrderRef = useRef<string[]>([]);
  const hasAutoNavigatedRef = useRef(false);
  const lastRestoredSessionIdRef = useRef<string | null>(initialSessionId ?? null);
  const lastSyncedIndexRef = useRef<number | null>(null);
  const restoreAttemptedSessionIdRef = useRef<string | null>(initialSessionId ?? null);
  const ignoreRestoreRef = useRef(false);
  const trackListRef = useRef<HTMLDivElement | null>(null);
  const zipCancelRequestedRef = useRef(false);
  const coverCacheRef = useRef<Map<string, CoverPayload | null>>(new Map());

  const replaceSearchParams = useCallback(
    (nextParams: URLSearchParams | Record<string, string>) => {
      const resolved = nextParams instanceof URLSearchParams ? nextParams : new URLSearchParams(nextParams);
      const query = resolved.toString();
      router.replace(query ? `/?${query}` : "/");
    },
    [router]
  );

  const isLoading = status === "loading";
  const currentTrack = match.track;
  const isFirstTrack = match.index === 0;
  const isLastTrack = match.total > 0 && match.index + 1 >= match.total;

  const progressLabel = useMemo(() => {
    if (!match.total) return "";
    return `${(match.index + 1).toLocaleString()} / ${match.total.toLocaleString()}`;
  }, [match.index, match.total]);

  const autoQueueLabel = useMemo(() => {
    if (!autoQueueProgress) return "";
    return `Auto-queue running · ${autoQueueProgress.index + 1} / ${autoQueueProgress.total}`;
  }, [autoQueueProgress]);

  const currentSession = useMemo(() => {
    if (!activeSessionId) return null;
    return sessions.find((session) => session.id === activeSessionId) ?? null;
  }, [activeSessionId, sessions]);
  const activeTotalTracks = currentSession?.totalTracks ?? match.total;
  const activeDownloadCount = downloads.length;
  const downloadIndexSet = useMemo(() => new Set(downloads.map((entry) => entry.index)), [downloads]);

  const currentCover = match.results[0]?.album?.cover ?? null;
  const currentSpotifyUrl = currentTrack ? buildSpotifyUrl(currentTrack.trackUri) : "";
  const singleTemplateValidation = useMemo(() => validateDownloadTemplate(singleTemplateDraft), [singleTemplateDraft]);
  const zipTemplateValidation = useMemo(() => validateDownloadTemplate(zipTemplateDraft), [zipTemplateDraft]);
  const previewContext = useMemo(() => {
    const selectedItem = selectedId
      ? match.results.find((item) => String(item.id) === selectedId) ?? null
      : match.results[0] ?? null;
    return buildTemplateContext(currentTrack, selectedItem ?? null, currentTrack ? match.index : null);
  }, [currentTrack, match.results, selectedId]);
  const singleTemplatePreview = useMemo(() => {
    if (!singleTemplateValidation.ok) return null;
    const rendered = renderTemplate(singleTemplateDraft, previewContext);
    const sanitized = ensureFlacPath(sanitizeZipPath(rendered));
    const filename = sanitized.split("/").pop() ?? "";
    return filename ? ensureFlacExtension(filename) : null;
  }, [previewContext, singleTemplateDraft, singleTemplateValidation.ok]);
  const singleTemplateError = singleTemplateValidation.ok ? null : singleTemplateValidation.message;
  const zipPathPreview = useMemo(() => {
    if (!zipTemplateValidation.ok) return null;
    const rendered = renderTemplate(zipTemplateDraft, previewContext);
    const sanitized = sanitizeZipPath(rendered);
    return sanitized ? ensureFlacPath(sanitized) : null;
  }, [previewContext, zipTemplateDraft, zipTemplateValidation.ok]);
  const zipTemplateError = zipTemplateValidation.ok ? null : zipTemplateValidation.message;

  const normalizeSearch = useCallback((value: string) => {
    return value
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  }, []);

  const matchesDownloadSearch = useCallback(
    (query: string, text: string) => {
      const normalizedQuery = normalizeSearch(query);
      if (!normalizedQuery) return true;
      const normalizedText = normalizeSearch(text);
      const tokens = normalizedQuery.split(" ").filter(Boolean);
      return tokens.every((token) => normalizedText.includes(token));
    },
    [normalizeSearch]
  );

  const formatDownloadLabel = useCallback((entry: DownloadEntry) => {
    const title = entry.item.title || entry.track.trackName || "Unknown Track";
    const artist = entry.item.artist?.name || entry.track.artistName || "Unknown Artist";
    return `${artist} · ${title}`;
  }, []);

  const formatTrackListLabel = useCallback((entry: TrackListEntry) => {
    const artist = entry.track.artistName || "Unknown Artist";
    const title = entry.track.trackName || "Unknown Track";
    return `${artist} - ${title}`;
  }, []);

  const filteredTrackList = useMemo(() => {
    if (!trackList) return null;
    if (!trackListSearch.trim()) return trackList;
    return trackList.filter((entry) => matchesDownloadSearch(trackListSearch, formatTrackListLabel(entry)));
  }, [formatTrackListLabel, matchesDownloadSearch, trackList, trackListSearch]);
  const trackListHasQuery = trackListSearch.trim().length > 0;

  const showFfmpegToast = useCallback(
    (entry: DownloadEntry) => {
      setFfmpegToast({
        open: true,
        title: "Converting with FFmpeg",
        description: formatDownloadLabel(entry),
        progress: null,
      });
    },
    [formatDownloadLabel]
  );

  const updateFfmpegToastProgress = useCallback((progress: number | null) => {
    setFfmpegToast((prev) => {
      if (!prev.open) return prev;
      return { ...prev, progress };
    });
  }, []);

  const hideFfmpegToast = useCallback(() => {
    setFfmpegToast((prev) => {
      if (!prev.open) return prev;
      return { ...prev, open: false, progress: null };
    });
  }, []);

  const showZipToast = useCallback(
    (entry: DownloadEntry | null, current: number, total: number) => {
      const safeTotal = Math.max(total, 1);
      const progress = Math.min(Math.max(current / safeTotal, 0), 1);
      const label = entry ? formatDownloadLabel(entry) : "Preparing";
      setZipToast({
        open: true,
        title: "Creating zip",
        description: `${current.toLocaleString()} / ${total.toLocaleString()} · ${label}`,
        progress,
      });
    },
    [formatDownloadLabel]
  );

  const hideZipToast = useCallback(() => {
    setZipToast((prev) => {
      if (!prev.open) return prev;
      return { ...prev, open: false, progress: null };
    });
  }, []);

  const requestZipCancel = useCallback(() => {
    if (!zipDownloading || zipCancelRequested) return;
    setZipCancelOpen(true);
  }, [zipCancelRequested, zipDownloading]);

  const confirmZipCancel = useCallback(() => {
    zipCancelRequestedRef.current = true;
    setZipCancelRequested(true);
    setZipCancelOpen(false);
  }, []);

  const setEntryDownloadStatus = useCallback((key: string, status: "checking" | "converting" | null) => {
    setDownloadStatus((prev) => {
      if (!status) {
        if (!(key in prev)) return prev;
        const next = { ...prev };
        delete next[key];
        return next;
      }

      return {
        ...prev,
        [key]: status,
      };
    });
  }, []);

  const triggerBlobDownload = useCallback((blob: Blob, filename: string) => {
    const blobUrl = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = blobUrl;
    link.download = filename;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(blobUrl), 0);
  }, []);

  const buildDownloadFilename = useCallback(
    (entry: DownloadEntry) => {
      const validation = validateDownloadTemplate(singleDownloadTemplate);
      const resolvedTemplate = validation.ok ? singleDownloadTemplate : DEFAULT_SINGLE_DOWNLOAD_TEMPLATE;
      const rendered = renderTemplate(resolvedTemplate, buildTemplateContext(entry.track, entry.item, entry.index));
      const sanitizedPath = ensureFlacPath(sanitizeZipPath(rendered));
      const filename = sanitizedPath.split("/").pop() ?? "";
      const fallback = sanitizeFilename(`${entry.track.artistName} - ${entry.track.trackName}.flac`);
      return ensureFlacExtension(filename || fallback || "track.flac");
    },
    [singleDownloadTemplate]
  );

  const fetchSegmentBuffer = useCallback(async (urls: string[]) => {
    const buffers: Uint8Array[] = [];
    let totalLength = 0;

    for (const url of urls) {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Segment download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());
      buffers.push(buffer);
      totalLength += buffer.length;
    }

    const combined = new Uint8Array(totalLength);
    let offset = 0;
    for (const buffer of buffers) {
      combined.set(buffer, offset);
      offset += buffer.length;
    }

    return combined;
  }, []);

  const resolveCoverPayload = useCallback(
    async (entry: DownloadEntry): Promise<CoverPayload | null> => {
      const coverUrl = entry.item.album.cover ?? null;
      if (!coverUrl) return null;

      const cache = coverCacheRef.current;
      if (cache.has(coverUrl)) {
        return cache.get(coverUrl) ?? null;
      }

      try {
        const response = await fetch(buildCoverProxyUrl(coverUrl));
        if (!response.ok) {
          throw new Error(`Cover download failed: ${response.status} ${response.statusText}`);
        }
        const mimeType = response.headers.get("Content-Type") ?? "image/jpeg";
        if (!mimeType.startsWith("image/")) {
          throw new Error(`Unsupported cover type: ${mimeType}`);
        }
        const extension: CoverPayload["extension"] = mimeType.includes("png")
          ? "png"
          : mimeType.includes("jpeg")
            ? "jpeg"
            : "jpg";
        const buffer = new Uint8Array(await response.arrayBuffer());
        const payload: CoverPayload = { buffer, mimeType, extension };
        cache.set(coverUrl, payload);
        return payload;
      } catch (error) {
        console.warn(`⚠️ Cover download failed: ${error}`);
        cache.set(coverUrl, null);
        return null;
      }
    },
    []
  );

  const buildDownloadKey = useCallback((index: number, itemId: number) => createDownloadKey(index, itemId), []);
  const buildDownloadUrl = useCallback(
    (index: number) => {
      const params = new URLSearchParams();
      if (singleDownloadTemplate.trim()) {
        params.set("template", singleDownloadTemplate);
      }
      const query = params.toString();
      return `/api/session/${sessionId ?? ""}/download/${index}${query ? `?${query}` : ""}`;
    },
    [sessionId, singleDownloadTemplate]
  );

  const filteredDownloads = useMemo(() => {
    if (!downloadSearch.trim()) return downloads;
    return downloads.filter((entry) => {
      const searchText = [
        entry.track.trackName,
        entry.track.artistName,
        entry.track.albumName,
        entry.item.title,
        entry.item.artist?.name,
        entry.item.album?.title,
      ]
        .filter(Boolean)
        .join(" ");
      return matchesDownloadSearch(downloadSearch, searchText);
    });
  }, [downloadSearch, downloads, matchesDownloadSearch]);

  const fetchDownloadInfo = useCallback(
    async (trackIndex: number): Promise<DownloadInfoResponse> => {
      if (!sessionId) {
        throw new Error("No active session.");
      }

      const infoResponse = await fetch(buildApiUrl(`/api/session/${sessionId}/download/${trackIndex}/info`));
      if (!infoResponse.ok) {
        throw new Error(await infoResponse.text());
      }

      return (await infoResponse.json()) as DownloadInfoResponse;
    },
    [sessionId]
  );

  const fetchDownloadBlob = useCallback(
    async (entry: DownloadEntry, infoOverride?: DownloadInfoResponse): Promise<Blob> => {
      if (!sessionId) {
        throw new Error("No active session.");
      }

      const info = infoOverride ?? (await fetchDownloadInfo(entry.index));
      const metadata = buildFlacMetadata(entry);
      const coverPayload = await resolveCoverPayload(entry);
      const coverForTags: FlacPicture | null = coverPayload
        ? { buffer: coverPayload.buffer, mimeType: coverPayload.mimeType }
        : null;

      if (info.requiresConversion) {
        const response = await fetch(buildApiUrl(`/api/session/${sessionId}/download/${entry.index}/manifest`));
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const manifest = (await response.json()) as DownloadManifestResponse;
        const segmentUrls = manifest.kind === "mpd"
          ? [manifest.segments.initialization, ...manifest.segments.segments]
          : [];

        let sourceBuffer: Uint8Array;

        if (manifest.kind === "url") {
          const streamResponse = await fetch(manifest.url);
          if (!streamResponse.ok) {
            throw new Error(`Stream download failed: ${streamResponse.status} ${streamResponse.statusText}`);
          }
          sourceBuffer = new Uint8Array(await streamResponse.arrayBuffer());
        } else {
          sourceBuffer = await fetchSegmentBuffer(segmentUrls);
        }

        showFfmpegToast(entry);
        try {
          const flacBuffer = await convertMp4ToFlac(sourceBuffer, updateFfmpegToastProgress);
          const tagged = applyFlacTags(flacBuffer, metadata, coverForTags);
          const flacCopy = new Uint8Array(tagged);
          return new Blob([flacCopy.buffer], { type: "audio/flac" });
        } catch (error) {
          console.warn(`⚠️ Conversion with metadata failed (mp4): ${error}`);
          try {
            const fallbackBuffer = await convertMp4ToFlac(sourceBuffer, updateFfmpegToastProgress);
            const taggedFallback = applyFlacTags(fallbackBuffer, metadata, null);
            const fallbackCopy = new Uint8Array(taggedFallback);
            setError("Tagging failed for a track; delivered without cover art.");
            return new Blob([fallbackCopy.buffer], { type: "audio/flac" });
          } catch (fallbackError) {
            console.warn(`⚠️ Conversion fallback failed (mp4): ${fallbackError}`);
            throw error instanceof Error ? error : new Error("Conversion failed.");
          }
        } finally {
          hideFfmpegToast();
        }
      }

      const downloadUrl = buildDownloadUrl(entry.index);
      const response = await fetch(downloadUrl);
      if (!response.ok) {
        throw new Error(`Download failed: ${response.status} ${response.statusText}`);
      }
      const buffer = new Uint8Array(await response.arrayBuffer());

      try {
        const taggedBuffer = applyFlacTags(buffer, metadata, coverForTags);
        const taggedCopy = new Uint8Array(taggedBuffer);
        return new Blob([taggedCopy.buffer], { type: "audio/flac" });
      } catch (error) {
        console.warn(`⚠️ Tagging failed (flac): ${error}`);
        try {
          const fallbackBuffer = applyFlacTags(buffer, metadata, null);
          const fallbackCopy = new Uint8Array(fallbackBuffer);
          setError("Tagging failed for a track; delivered without cover art.");
          return new Blob([fallbackCopy.buffer], { type: "audio/flac" });
        } catch (fallbackError) {
          console.warn(`⚠️ Tagging fallback failed (flac): ${fallbackError}`);
          // Last resort: return original buffer so download still completes.
          setError("Tagging failed; delivered original audio without metadata.");
          return new Blob([buffer.buffer], { type: "audio/flac" });
        }
      }
    },
    [
      buildDownloadUrl,
      fetchDownloadInfo,
      fetchSegmentBuffer,
      hideFfmpegToast,
      resolveCoverPayload,
      sessionId,
      setError,
      showFfmpegToast,
      updateFfmpegToastProgress,
    ]
  );

  const handleDownloadEntry = useCallback(
    async (entry: DownloadEntry) => {
      if (!sessionId) return;
      const downloadKey = buildDownloadKey(entry.index, entry.item.id);
      setEntryDownloadStatus(downloadKey, "checking");

      try {
        const info = await fetchDownloadInfo(entry.index);
        setEntryDownloadStatus(downloadKey, "converting");
        const blob = await fetchDownloadBlob(entry, info);
        const filename = buildDownloadFilename(entry);
        triggerBlobDownload(blob, filename);
        setEntryDownloadStatus(downloadKey, null);
      } catch (err) {
        setEntryDownloadStatus(downloadKey, null);
        const message = err instanceof Error ? err.message : "Download failed.";
        setError(message);
      }
    },
    [
      buildDownloadFilename,
      buildDownloadKey,
      fetchDownloadBlob,
      fetchDownloadInfo,
      sessionId,
      setEntryDownloadStatus,
      triggerBlobDownload,
    ]
  );

  const releaseYear = useCallback((date: string) => {
    return extractReleaseYear(date);
  }, []);

  const delay = useCallback((ms: number) => new Promise<void>((resolve) => window.setTimeout(resolve, ms)), []);

  const resolveSelectedId = useCallback((data: MatchResponse) => {
    if (!data.track) return "";
    const savedEntry = downloadsRef.current.find((entry) => entry.index === data.index);
    if (savedEntry) {
      const hasMatch = data.results.some((item) => item.id === savedEntry.item.id);
      if (hasMatch) return String(savedEntry.item.id);
    }
    return "";
  }, []);

  const loadNext = useCallback(
    async (activeSessionId: string) => {
      const response = await fetch(buildApiUrl(`/api/session/${activeSessionId}/next`));
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = normalizeMatchResponse((await response.json()) as MatchResponse);
      setMatch(data);
      setSelectedId(resolveSelectedId(data));
      return data;
    },
    [resolveSelectedId, setMatch]
  );

  const loadTrackByIndex = useCallback(async (activeSessionId: string, index: number) => {
    const response = await fetch(buildApiUrl(`/api/session/${activeSessionId}/track/${index}`));
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const data = normalizeMatchResponse((await response.json()) as MatchResponse);
    setMatch(data);
    setSelectedId(resolveSelectedId(data));
    return data;
  }, [resolveSelectedId]);

  const fetchTrackByIndex = useCallback(async (activeSessionId: string, index: number) => {
    const response = await fetch(buildApiUrl(`/api/session/${activeSessionId}/track/${index}`));
    if (!response.ok) {
      throw new Error(await response.text());
    }
    return normalizeMatchResponse((await response.json()) as MatchResponse);
  }, []);

  const shortHash = useCallback((hash: string) => hash.slice(0, 12), []);
  const handleSettingsOpenChange = useCallback(
    (open: boolean) => {
      setSettingsOpen(open);
      if (open) {
        setSingleTemplateDraft(singleDownloadTemplate);
        setZipTemplateDraft(zipDownloadTemplate);
        setIncludeAlbumCoverDraft(includeAlbumCover);
      }
    },
    [includeAlbumCover, singleDownloadTemplate, zipDownloadTemplate]
  );
  const saveSingleTemplate = useCallback((value: string) => {
    const next = value.trim();
    if (!next) return;
    setSingleDownloadTemplate(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(SINGLE_DOWNLOAD_TEMPLATE_KEY, next);
      localStorage.setItem(DOWNLOAD_TEMPLATE_KEY, next);
    }
  }, []);
  const saveZipTemplate = useCallback((value: string) => {
    const next = value.trim();
    if (!next) return;
    setZipDownloadTemplate(next);
    if (typeof window !== "undefined") {
      localStorage.setItem(ZIP_DOWNLOAD_TEMPLATE_KEY, next);
      localStorage.setItem(DOWNLOAD_TEMPLATE_KEY, next);
    }
  }, []);
  const saveIncludeAlbumCover = useCallback((value: boolean) => {
    setIncludeAlbumCover(value);
    if (typeof window !== "undefined") {
      localStorage.setItem(INCLUDE_ALBUM_COVER_KEY, String(value));
    }
  }, []);
  const handleSaveTemplate = useCallback(() => {
    const singleValidation = validateDownloadTemplate(singleTemplateDraft);
    const zipValidation = validateDownloadTemplate(zipTemplateDraft);
    if (!singleValidation.ok || !zipValidation.ok) {
      return;
    }
    saveSingleTemplate(singleTemplateDraft);
    saveZipTemplate(zipTemplateDraft);
    saveIncludeAlbumCover(includeAlbumCoverDraft);
    setSettingsOpen(false);
  }, [includeAlbumCoverDraft, saveSingleTemplate, saveIncludeAlbumCover, saveZipTemplate, singleTemplateDraft, zipTemplateDraft]);
  const loadSessions = useCallback(async () => {
    const response = await fetch(buildApiUrl("/api/sessions"));
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const data = (await response.json()) as { sessions: SessionSummary[] };
    setSessions(data.sessions);
    if (typeof window !== "undefined") {
      localStorage.setItem(SESSIONS_KEY, JSON.stringify(data.sessions.map((session) => session.id)));
    }
    return data.sessions;
  }, []);

  const loadDownloads = useCallback(async (activeSessionId: string) => {
    const response = await fetch(buildApiUrl(`/api/session/${activeSessionId}/downloads`));
    if (!response.ok) {
      throw new Error(await response.text());
    }
    const data = (await response.json()) as { downloads: DownloadEntry[] };
    const entries = data.downloads;
    const orderMap = new Map(downloadOrderRef.current.map((key, index) => [key, index]));
    const sorted = [...entries].sort((a, b) => {
      const aKey = createDownloadKey(a.index, a.item.id);
      const bKey = createDownloadKey(b.index, b.item.id);
      const aOrder = orderMap.get(aKey);
      const bOrder = orderMap.get(bKey);
      if (aOrder !== undefined && bOrder !== undefined) {
        return aOrder - bOrder;
      }
      if (aOrder !== undefined) return -1;
      if (bOrder !== undefined) return 1;
      return b.index - a.index;
    });
    setDownloads(sorted);

    const entryKeys = new Set(entries.map((entry) => createDownloadKey(entry.index, entry.item.id)));
    const nextOrder = downloadOrderRef.current.filter((key) => entryKeys.has(key));
    if (nextOrder.length !== downloadOrderRef.current.length) {
      setDownloadOrder(nextOrder);
    }
  }, []);

  const loadTrackList = useCallback(async (activeSessionId: string) => {
    setTrackListLoading(true);
    setTrackListError(null);
    try {
      const response = await fetch(buildApiUrl(`/api/session/${activeSessionId}/tracks`));
      if (!response.ok) {
        throw new Error(await response.text());
      }
      const data = (await response.json()) as TrackListResponse;
      const tracks = Array.isArray(data.tracks) ? data.tracks : [];
      setTrackList(tracks);
      return tracks;
    } catch (err) {
      setTrackListError(err instanceof Error ? err.message : "Failed to load track list.");
      return null;
    } finally {
      setTrackListLoading(false);
    }
  }, []);

  const restoreSession = useCallback(
    async (activeSessionId: string, indexOverride?: number | null) => {
      setStatus("loading");
      setError(null);
      setSessionId(activeSessionId);
      setActiveSessionId(activeSessionId);
      if (typeof window !== "undefined") {
        localStorage.setItem(ACTIVE_SESSION_KEY, activeSessionId);
      }
      try {
        if (typeof indexOverride === "number" && Number.isFinite(indexOverride) && indexOverride >= 0) {
          await loadTrackByIndex(activeSessionId, indexOverride);
        } else {
          await loadNext(activeSessionId);
        }
        await loadDownloads(activeSessionId);
      } catch (err) {
        setSessionId(null);
        setMatch(EMPTY_MATCH);
        setError(err instanceof Error ? err.message : "Stored session could not be restored.");
      } finally {
        setStatus("idle");
      }
    },
    [loadDownloads, loadNext, loadTrackByIndex]
  );

  const clearSession = useCallback(
    async (id: string) => {
      await fetch(buildApiUrl(`/api/session/${id}`), { method: "DELETE" });
      if (sessionId === id) {
        setSessionId(null);
        setActiveSessionId(null);
        setDownloads([]);
        setMatch(EMPTY_MATCH);
        if (typeof window !== "undefined") {
          localStorage.removeItem(ACTIVE_SESSION_KEY);
        }
        replaceSearchParams(new URLSearchParams());
      }
      try {
        await loadSessions();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to refresh sessions.");
      }
    },
    [loadSessions, replaceSearchParams, sessionId]
  );

  const startSession = useCallback(
    async (file: File) => {
      setStatus("loading");
      setError(null);
      setAutoQueueing(false);
      setAutoQueueProgress(null);
      lastAutoMatchedIndex.current = null;

      try {
        const formData = new FormData();
        formData.append("file", file);

        const response = await fetch(buildApiUrl("/api/session"), { method: "POST", body: formData });
        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = (await response.json()) as SessionResponse;
        setSessionId(data.sessionId);
        setActiveSessionId(data.sessionId);
        if (typeof window !== "undefined") {
          localStorage.setItem(ACTIVE_SESSION_KEY, data.sessionId);
        }
        await loadNext(data.sessionId);
        await loadDownloads(data.sessionId);
        await loadSessions();
        return data.sessionId;
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to start session.");
        return null;
      } finally {
        setStatus("idle");
      }
    },
    [loadDownloads, loadNext, loadSessions]
  );

  const handleFileUpload = useCallback(
    async (file: File) => {
      setStatus("loading");
      try {
        const newSessionId = await startSession(file);
        if (newSessionId) {
          lastRestoredSessionIdRef.current = newSessionId;
          restoreAttemptedSessionIdRef.current = newSessionId;
          replaceSearchParams({ sessionId: newSessionId });
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to read CSV file.");
        setStatus("idle");
      }
    },
    [replaceSearchParams, startSession]
  );

  const handleUploadClick = useCallback(() => {
    ignoreRestoreRef.current = true;
    setSessionId(null);
    setActiveSessionId(null);
    setMatch(EMPTY_MATCH);
    setSelectedId("");
    setDownloads([]);
    setError(null);
    setStatus("idle");
    setAutoQueueing(false);
    setAutoQueueProgress(null);
    restoreAttemptedSessionIdRef.current = null;
    replaceSearchParams(new URLSearchParams());
  }, [replaceSearchParams]);

  useEffect(() => {
    if (typeof window === "undefined") return;
    const restore = async () => {
      try {
        await loadSessions();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load sessions.");
      }
      hasAutoNavigatedRef.current = true;
    };
    void restore();
  }, [loadSessions]);

  const submitSelection = useCallback(
    async (kind: "track" | "none" | "skip", forcedId?: string) => {
      if (!sessionId || !currentTrack) return;
      const resolvedId = forcedId ?? selectedId;
      const queuedKey = kind === "track" && resolvedId ? buildDownloadKey(match.index, Number(resolvedId)) : null;
      if (kind === "track" && !resolvedId) {
        setError("Select a match before continuing.");
        return;
      }

      setStatus("loading");
      setError(null);

      try {
        const response = await fetch(buildApiUrl(`/api/session/${sessionId}/select`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            kind,
            trackId: kind === "track" ? Number(resolvedId) : undefined,
          }),
        });

        if (!response.ok) {
          throw new Error(await response.text());
        }

        const data = normalizeMatchResponse((await response.json()) as MatchResponse);

        if (queuedKey) {
          setDownloadOrder((prev) => [queuedKey, ...prev.filter((key) => key !== queuedKey)]);
        }
        setMatch(data);
        setSelectedId(resolveSelectedId(data));
        await loadDownloads(sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to save selection.");
      } finally {
        setStatus("idle");
      }
    },
    [buildDownloadKey, currentTrack, loadDownloads, match.index, resolveSelectedId, selectedId, sessionId]
  );

  const handleMatchSelection = useCallback(
    (value: string) => {
      setSelectedId(value);
      if (isLoading || autoQueueing) return;
      void submitSelection("track", value);
    },
    [autoQueueing, isLoading, submitSelection]
  );

  const downloadZip = useCallback(async () => {
    if (!sessionId || downloads.length === 0) return;
    if (zipDownloading) return;
    setZipDownloading(true);
    setZipCancelRequested(false);
    setZipCancelOpen(false);
    zipCancelRequestedRef.current = false;
    showZipToast(null, 0, downloads.length);

    const zipWriter = new ZipWriter(new BlobWriter("application/zip"));
    const failures: string[] = [];
    const coverStatus = new Map<string, "added" | "failed">();
    let cancelled = false;

    try {
      for (let i = 0; i < downloads.length; i += 1) {
        if (zipCancelRequestedRef.current) {
          cancelled = true;
          break;
        }
        const entry = downloads[i];
        if (!entry) continue;
        showZipToast(entry, i + 1, downloads.length);

        try {
          const blob = await fetchDownloadBlob(entry);
          if (zipCancelRequestedRef.current) {
            cancelled = true;
            break;
          }
          const zipEntryName = buildZipEntryPath(entry, zipDownloadTemplate);
          await zipWriter.add(zipEntryName, new BlobReader(blob));
          if (includeAlbumCover) {
            const coverPath = buildAlbumCoverPath(zipEntryName);
            if (coverPath && !coverStatus.has(coverPath)) {
              const coverUrl = entry.item.album.cover ?? null;
              if (coverUrl) {
                try {
                  const coverResponse = await fetch(buildCoverProxyUrl(coverUrl));
                  if (!coverResponse.ok) {
                    throw new Error(`Cover download failed: ${coverResponse.status} ${coverResponse.statusText}`);
                  }
                  const coverBlob = await coverResponse.blob();
                  await zipWriter.add(coverPath, new BlobReader(coverBlob));
                  coverStatus.set(coverPath, "added");
                } catch (error) {
                  coverStatus.set(coverPath, "failed");
                  console.warn(`⚠️ Cover download failed: ${error}`);
                }
              }
            }
          }
        } catch (error) {
          const failureArtist = entry.item.artist?.name || entry.track.artistName || "Unknown Artist";
          const failureTitle = entry.item.title || entry.track.trackName || "Unknown Track";
          failures.push(`${failureArtist} - ${failureTitle}`);
          console.warn(`⚠️ Zip entry failed: ${error}`);
        }
      }

      if (cancelled) {
        await zipWriter.close();
        setError("Zip download cancelled.");
        return;
      }

      const zipBlob = await zipWriter.close();
      const zipName = buildZipFilename(currentSession?.filename ?? null);
      triggerBlobDownload(zipBlob, zipName);

      if (failures.length > 0) {
        setError(`Some tracks failed to zip (${failures.length}).`);
      }
    } catch (error) {
      setError(error instanceof Error ? error.message : "Zip download failed.");
    } finally {
      setZipDownloading(false);
      setZipCancelRequested(false);
      setZipCancelOpen(false);
      zipCancelRequestedRef.current = false;
      hideZipToast();
    }
  }, [currentSession?.filename, downloads, fetchDownloadBlob, hideZipToast, includeAlbumCover, sessionId, setError, showZipToast, triggerBlobDownload, zipDownloadTemplate, zipDownloading]);

  useEffect(() => {
    autoQueueingRef.current = autoQueueing;
    if (!autoQueueing) {
      autoQueueRunning.current = false;
    }
  }, [autoQueueing]);

  useEffect(() => {
    downloadsRef.current = downloads;
  }, [downloads]);

  useEffect(() => {
    downloadOrderRef.current = downloadOrder;
  }, [downloadOrder]);

  useEffect(() => {
    if (!autoQueueing) return;
    if (!sessionId || !currentTrack) return;
    if (autoQueueRunning.current) return;

    autoQueueRunning.current = true;
    const runAutoQueue = async () => {
      setError(null);
      let current = match;
      const downloadIndices = downloadsRef.current
        .map((entry) => entry.index)
        .filter((index) => index >= 0 && index < current.total);
      const maxDownloadedIndex = downloadIndices.length > 0 ? Math.max(...downloadIndices) : -1;
      let startIndex = Math.max(current.index, maxDownloadedIndex + 1);

      if (startIndex >= current.total) {
        if (current.index < current.total) {
          startIndex = current.index;
        } else {
          setError("Auto-queue stopped: no remaining tracks to process.");
          setAutoQueueProgress({ index: current.index, total: current.total });
          autoQueueRunning.current = false;
          setAutoQueueing(false);
          setAutoQueueProgress(null);
          lastAutoMatchedIndex.current = null;
          return;
        }
      }

      if (startIndex !== current.index) {
        try {
          current = await fetchTrackByIndex(sessionId, startIndex);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Auto-queue failed.");
          autoQueueRunning.current = false;
          setAutoQueueing(false);
          setAutoQueueProgress(null);
          lastAutoMatchedIndex.current = null;
          return;
        }
      }

      setAutoQueueProgress({ index: current.index, total: current.total });
      while (autoQueueingRef.current) {
        if (current.done || !current.track) {
          break;
        }

        if (lastAutoMatchedIndex.current === current.index) {
          break;
        }

        lastAutoMatchedIndex.current = current.index;
        const suggestedId = current.suggestedId ?? current.results[0]?.id ?? null;
        setAutoQueueProgress({ index: current.index, total: current.total });
        const currentTrackUri = current.track?.trackUri;
        const alreadyQueued = Boolean(
          currentTrackUri && downloadsRef.current.some((entry) => entry.track.trackUri === currentTrackUri)
        );

        if (alreadyQueued) {
          const nextIndex = current.index + 1;
          if (nextIndex >= current.total) {
            break;
          }

          try {
            const data = await fetchTrackByIndex(sessionId, nextIndex);
            current = data;
            await delay(200);
            continue;
          } catch (err) {
            setError(err instanceof Error ? err.message : "Auto-queue failed.");
            break;
          }
        }

        try {
          const queuedKey = suggestedId ? buildDownloadKey(current.index, suggestedId) : null;
          const response = await fetch(buildApiUrl(`/api/session/${sessionId}/select`), {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              kind: suggestedId ? "track" : "skip",
              trackId: suggestedId ?? undefined,
            }),
          });

          if (!response.ok) {
            throw new Error(await response.text());
          }

          const data = normalizeMatchResponse((await response.json()) as MatchResponse);

          current = data;
          if (queuedKey) {
            setDownloadOrder((prev) => [queuedKey, ...prev.filter((key) => key !== queuedKey)]);
          }
          await loadDownloads(sessionId);
          await delay(350);
        } catch (err) {
          setError(err instanceof Error ? err.message : "Auto-queue failed.");
          break;
        }
      }

      autoQueueRunning.current = false;
      setAutoQueueing(false);
      setAutoQueueProgress(null);
      lastAutoMatchedIndex.current = null;
      const stopIndex = stopAutoQueueIndexRef.current;
      const originIndex = autoQueueOriginIndexRef.current;
      stopAutoQueueIndexRef.current = null;
      autoQueueOriginIndexRef.current = null;
      let shouldSetMatch = true;

      const returnIndex = stopIndex ?? originIndex;
      if (returnIndex !== null && sessionId && returnIndex !== current.index) {
        try {
          await loadTrackByIndex(sessionId, returnIndex);
          shouldSetMatch = false;
        } catch (err) {
          setError(err instanceof Error ? err.message : "Failed to return to prior track.");
        }
      }

      if (shouldSetMatch) {
        setMatch(current);
        setSelectedId(resolveSelectedId(current));
      }
      try {
        await loadDownloads(sessionId);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to sync after auto-queue.");
      }
    };

    void runAutoQueue();
  }, [autoQueueing, buildDownloadKey, currentTrack, fetchTrackByIndex, loadDownloads, loadNext, loadTrackByIndex, match, resolveSelectedId, sessionId]);

  const navigateSession = useCallback(
    async (direction: "prev" | "next") => {
      if (!sessionId) return;
      if (!currentTrack) return;

      const nextIndex = direction === "prev" ? match.index - 1 : match.index + 1;
      if (nextIndex < 0 || nextIndex >= match.total) return;

      setStatus("loading");
      setError(null);

      try {
        await loadTrackByIndex(sessionId, nextIndex);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to navigate tracks.");
      } finally {
        setStatus("idle");
      }
    },
    [currentTrack, loadTrackByIndex, match.index, match.total, sessionId]
  );

  const openDownloadMatch = useCallback(
    async (entry: DownloadEntry) => {
      if (!sessionId) return;
      setStatus("loading");
      setError(null);

      try {
        const data = await loadTrackByIndex(sessionId, entry.index);
        const hasMatch = data.results.some((item) => item.id === entry.item.id);
        setSelectedId(hasMatch ? String(entry.item.id) : "");
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load saved match.");
      } finally {
        setStatus("idle");
      }
    },
    [loadTrackByIndex, sessionId]
  );

  const removeDownload = useCallback(
    async (index: number, itemId: number) => {
      if (!sessionId) return;
      const removeKey = buildDownloadKey(index, itemId);
      setDownloads((prev) => prev.filter((entry) => buildDownloadKey(entry.index, entry.item.id) !== removeKey));
      setDownloadOrder((prev) => prev.filter((key) => key !== removeKey));
      try {
        const response = await fetch(buildApiUrl(`/api/session/${sessionId}/remove`), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ index }),
        });
        if (!response.ok) {
          throw new Error(await response.text());
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to remove saved download.");
        await loadDownloads(sessionId);
      } finally {
        void loadDownloads(sessionId);
      }
    },
    [buildDownloadKey, loadDownloads, sessionId]
  );

  const downloadRowData = useMemo<DownloadRowData>(
    () => ({
      entries: filteredDownloads,
      buildDownloadKey,
      downloadStatus,
      isLoading,
      onOpenMatch: openDownloadMatch,
      onDownload: handleDownloadEntry,
      onRemove: removeDownload,
    }),
    [
      filteredDownloads,
      buildDownloadKey,
      downloadStatus,
      isLoading,
      openDownloadMatch,
      handleDownloadEntry,
      removeDownload,
    ]
  );

  const sessionIdParam = searchParams.get("sessionId");
  const requestedIndex = searchParams.get("index");
  const requestedIndexValue = requestedIndex ? Number(requestedIndex) : null;
  const searchIndexValue = requestedIndex ?? "";

  useEffect(() => {
    if (ignoreRestoreRef.current) {
      if (!sessionIdParam) {
        ignoreRestoreRef.current = false;
      }
      return;
    }
    if (!sessionIdParam) return;
    if (restoreAttemptedSessionIdRef.current === sessionIdParam) return;
    if (lastRestoredSessionIdRef.current === sessionIdParam && sessionId === sessionIdParam) return;
    if (lastRestoredSessionIdRef.current !== sessionIdParam) {
      lastSyncedIndexRef.current = null;
    }
    lastRestoredSessionIdRef.current = sessionIdParam;
    restoreAttemptedSessionIdRef.current = sessionIdParam;
    void restoreSession(sessionIdParam, requestedIndexValue);
  }, [requestedIndexValue, restoreSession, sessionId, sessionIdParam]);

  useEffect(() => {
    if (!sessionId || sessionId !== sessionIdParam) return;
    if (requestedIndexValue === null) return;
    if (!Number.isFinite(requestedIndexValue)) return;
    if (requestedIndexValue < 0) return;
    if (requestedIndexValue === match.index) return;
    if (lastSyncedIndexRef.current === requestedIndexValue) return;

    const loadFromUrl = async () => {
      setStatus("loading");
      setError(null);
      try {
        await loadTrackByIndex(sessionId, requestedIndexValue);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load track position.");
      } finally {
        setStatus("idle");
      }
    };

    void loadFromUrl();
  }, [loadTrackByIndex, match.index, requestedIndexValue, sessionId, sessionIdParam]);

  useEffect(() => {
    if (!sessionId) return;
    if (!currentTrack) return;
    const currentIndexValue = match.index;
    const currentIndex = String(currentIndexValue);
    if (searchIndexValue === currentIndex && sessionIdParam === sessionId) {
      lastSyncedIndexRef.current = currentIndexValue;
      return;
    }
    lastSyncedIndexRef.current = currentIndexValue;
    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.set("sessionId", sessionId);
    nextParams.set("index", currentIndex);
    replaceSearchParams(nextParams);
  }, [currentTrack, match.index, replaceSearchParams, searchIndexValue, searchParams, sessionId, sessionIdParam]);

  useEffect(() => {
    setTrackList(null);
    setTrackListOpen(false);
    setTrackListError(null);
    setTrackListSearch("");
  }, [sessionId]);

  useEffect(() => {
    if (trackListOpen) return;
    setTrackListSearch("");
  }, [trackListOpen]);

  useEffect(() => {
    if (!trackListOpen) return;
    const handlePointer = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null;
      if (!target || !trackListRef.current) return;
      if (!trackListRef.current.contains(target)) {
        setTrackListOpen(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setTrackListOpen(false);
      }
    };
    document.addEventListener("mousedown", handlePointer);
    document.addEventListener("touchstart", handlePointer);
    document.addEventListener("keydown", handleKey);
    return () => {
      document.removeEventListener("mousedown", handlePointer);
      document.removeEventListener("touchstart", handlePointer);
      document.removeEventListener("keydown", handleKey);
    };
  }, [trackListOpen]);

  const sessionPanel = sessionId ? (
      <>
        {match.done && (
          <Card>
            <CardHeader>
              <CardTitle className="text-balance font-serif">All tracks processed</CardTitle>
              <CardDescription className="text-pretty">
                You can keep downloading from your selection list below.
              </CardDescription>
            </CardHeader>
          </Card>
        )}

        {!match.done && currentTrack && (
          <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="min-w-0 flex flex-col md:h-[min(72vh,720px)]">
              <CardHeader className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="text-balance font-serif">Current Spotify track</CardTitle>
                    {autoQueueLabel && <span className="text-xs text-white/50 tabular-nums">{autoQueueLabel}</span>}
                  </div>
                  <div className="flex items-center gap-3">
                    {progressLabel && (
                      <div className="relative" ref={trackListRef}>
                        <Button
                          size="sm"
                          variant="ghost"
                          className="gap-2 text-white/60 hover:text-white"
                          onClick={() => {
                            setTrackListOpen((prev) => {
                              const next = !prev;
                              if (next && sessionId && !trackList && !trackListLoading) {
                                void loadTrackList(sessionId);
                              }
                              return next;
                            });
                          }}
                          aria-haspopup="listbox"
                          aria-expanded={trackListOpen}
                          aria-label="Jump to a specific track"
                          disabled={isLoading || autoQueueing}
                        >
                          <span className="text-xs text-white/50 tabular-nums">{progressLabel}</span>
                          <svg
                            viewBox="0 0 20 20"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.6"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className={cn("h-3 w-3 transition", trackListOpen && "rotate-180")}
                            aria-hidden="true"
                          >
                            <path d="M6 8l4 4 4-4" />
                          </svg>
                        </Button>
                        {trackListOpen && (
                          <div
                            className="absolute right-0 top-full z-30 mt-2 w-[min(360px,85vw)] rounded-lg border border-white/10 bg-zinc-950/95 shadow-xl backdrop-blur"
                            role="listbox"
                            aria-label="Track list"
                          >
                            <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
                              <p className="text-xs uppercase text-white/50">Jump to track</p>
                              <p className="text-xs text-white/40 tabular-nums">
                                {activeTotalTracks ? `${activeTotalTracks.toLocaleString()} total` : "Total unknown"}
                              </p>
                            </div>
                            <div className="border-b border-white/10 px-3 py-2">
                              <div className="relative">
                                <span className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-white/50">
                                  <svg
                                    viewBox="0 0 24 24"
                                    fill="none"
                                    stroke="currentColor"
                                    strokeWidth="1.6"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    className="h-3.5 w-3.5"
                                    aria-hidden="true"
                                  >
                                    <circle cx="11" cy="11" r="7" />
                                    <path d="M20 20l-3.5-3.5" />
                                  </svg>
                                </span>
                                <Input
                                  value={trackListSearch}
                                  onChange={(event) => setTrackListSearch(event.target.value)}
                                  placeholder="Search tracks"
                                  aria-label="Search tracks"
                                  className="h-8 pl-7 pr-8 text-xs"
                                />
                                {trackListHasQuery && (
                                  <button
                                    type="button"
                                    className="absolute right-1.5 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
                                    onClick={() => setTrackListSearch("")}
                                    aria-label="Clear track search"
                                  >
                                    <svg
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="1.8"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      className="h-3.5 w-3.5"
                                      aria-hidden="true"
                                    >
                                      <path d="M18 6L6 18" />
                                      <path d="M6 6l12 12" />
                                    </svg>
                                  </button>
                                )}
                              </div>
                            </div>
                            <div className="scroll-area max-h-72 overflow-y-auto px-2 py-2">
                              {trackListLoading && <p className="px-2 py-3 text-xs text-white/60">Loading tracks...</p>}
                              {!trackListLoading && trackListError && (
                                <p className="px-2 py-3 text-xs text-rose-200">{trackListError}</p>
                              )}
                              {!trackListLoading && !trackListError && (!filteredTrackList || filteredTrackList.length === 0) && (
                                <p className="px-2 py-3 text-xs text-white/60">
                                  {trackListHasQuery ? "No tracks match this search." : "No tracks found."}
                                </p>
                              )}
                              {!trackListLoading && !trackListError && filteredTrackList && filteredTrackList.length > 0 && (
                                <div className="flex flex-col gap-1">
                                  {filteredTrackList.map((entry) => {
                                    const isCurrent = entry.index === match.index;
                                    const isQueued = downloadIndexSet.has(entry.index);
                                    return (
                                      <button
                                        key={entry.index}
                                        type="button"
                                        className={cn(
                                          "flex items-center gap-3 rounded-md px-2 py-2 text-left text-xs transition hover:bg-white/10",
                                          isCurrent && "bg-white/10 text-white"
                                        )}
                                        onClick={() => {
                                          setTrackListOpen(false);
                                          if (!sessionId) return;
                                          if (entry.index === match.index) return;
                                          setStatus("loading");
                                          setError(null);
                                          void loadTrackByIndex(sessionId, entry.index)
                                            .catch((err) => {
                                              setError(err instanceof Error ? err.message : "Failed to navigate tracks.");
                                            })
                                            .finally(() => {
                                              setStatus("idle");
                                            });
                                        }}
                                      >
                                        <span
                                          className={cn(
                                            "flex h-2.5 w-2.5 items-center justify-center rounded-full border",
                                            isQueued ? "border-emerald-400 bg-emerald-400" : "border-white/30"
                                          )}
                                          aria-hidden="true"
                                        />
                                        <span className="flex-1 truncate text-white/70">{formatTrackListLabel(entry)}</span>
                                        <span className="text-[11px] text-white/40 tabular-nums">{entry.index + 1}</span>
                                      </button>
                                    );
                                  })}
                                </div>
                              )}
                            </div>
                          </div>
                        )}
                      </div>
                    )}
                    <div className="flex items-center gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigateSession("prev")}
                        disabled={isLoading || autoQueueing || isFirstTrack}
                        aria-label="Previous track"
                      >
                        ‹
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => navigateSession("next")}
                        disabled={isLoading || autoQueueing || isLastTrack}
                        aria-label="Next track"
                      >
                        ›
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-6 md:min-h-0 md:overflow-hidden">
                <div className="flex flex-wrap items-center gap-4 min-w-0">
                  <div className="size-24 shrink-0 overflow-hidden rounded-lg border border-white/10 bg-white/5">
                    {currentCover ? (
                      <img src={currentCover} alt="Album cover" className="size-full object-cover" />
                    ) : (
                      <div className="flex size-full items-center justify-center text-xs text-white/40">Cover</div>
                    )}
                  </div>
                  <div className="flex min-w-0 flex-col gap-1">
                    {currentSpotifyUrl ? (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <a
                            className="inline-flex items-center gap-2 text-lg font-semibold text-white break-words transition hover:text-white/80"
                            href={currentSpotifyUrl}
                            target="_blank"
                            rel="noreferrer"
                          >
                            {currentTrack.trackName}
                            <svg
                              viewBox="0 0 24 24"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.6"
                              strokeLinecap="round"
                              strokeLinejoin="round"
                              className="h-4 w-4 shrink-0"
                              aria-hidden="true"
                            >
                              <path d="M14 4h6v6" />
                              <path d="M10 14L20 4" />
                              <path d="M20 14v6H4V4h6" />
                            </svg>
                          </a>
                        </TooltipTrigger>
                        <TooltipContent align="start">Open on Spotify</TooltipContent>
                      </Tooltip>
                    ) : (
                      <p className="text-lg font-semibold text-white break-words">{currentTrack.trackName}</p>
                    )}
                    <p className="text-sm text-white/70 break-words">{currentTrack.artistName}</p>
                    <p className="text-sm text-white/60 break-words">{currentTrack.albumName}</p>
                    <p className="text-xs text-white/50 tabular-nums">{releaseYear(currentTrack.releaseDate)}</p>
                  </div>
                </div>

                <div className="flex flex-1 min-h-0 flex-col gap-3">
                  <p className="text-xs uppercase text-white/50">Tidal Matches</p>
                  <div className="scroll-area flex-1 min-h-0 md:overflow-y-auto md:pr-2">
                    <RadioGroup
                      value={selectedId}
                      onValueChange={handleMatchSelection}
                      aria-label="Match results"
                      className="flex flex-col gap-3"
                    >
                      {match.results.map((item: SearchTrackItem) => {
                        const isSelected = selectedId === String(item.id);
                        const optionId = `match-${item.id}`;
                        const isSuggested = match.suggestedId === item.id;
                        return (
                          <label
                            key={item.id}
                            htmlFor={optionId}
                            className={cn(
                              "flex min-w-0 cursor-pointer items-center gap-4 rounded-lg border px-4 py-3 text-sm",
                              isSelected ? "border-white bg-white text-black" : "border-white/10 bg-zinc-950 hover:bg-white/10"
                            )}
                          >
                            <RadioGroupItem id={optionId} value={String(item.id)} className="sr-only" />
                            <div className="size-12 shrink-0 overflow-hidden rounded-md border border-white/10 bg-white/5">
                              {item.album.cover ? (
                                <img
                                  src={item.album.cover}
                                  alt={`${item.album.title} cover`}
                                  className="size-full object-cover"
                                />
                              ) : (
                                <div className="flex size-full items-center justify-center text-[10px] text-white/40">No art</div>
                              )}
                            </div>
                            <div className="flex min-w-0 flex-1 flex-col gap-0">
                              <div className="flex items-center justify-between gap-2">
                                <p className={cn("flex items-center gap-2 font-medium break-words", isSelected ? "text-black" : "text-white")}>
                                  {item.title}
                                  {isSuggested && (
                                    <span
                                      className={cn(
                                        "rounded-md border px-1 py-[1px] text-[8px] uppercase tracking-[0.12em]",
                                        isSelected ? "border-black/20 bg-black/10 text-black/70" : "border-white/15 bg-white/5 text-white/60"
                                      )}
                                    >
                                      Suggested
                                    </span>
                                  )}
                                </p>
                                <div className="flex items-center gap-2">
                                  <span className={cn("text-xs tabular-nums", isSelected ? "text-black/70" : "text-white/50")}>
                                    {item.trackNumber ? `#${String(item.trackNumber).padStart(2, "0")}` : "--"}
                                  </span>
                                  <Tooltip>
                                    <TooltipTrigger asChild>
                                      <a
                                        className={cn(
                                          "inline-flex h-7 w-7 items-center justify-center rounded-md border border-transparent transition-colors",
                                          isSelected
                                            ? "text-black/70 hover:text-black hover:bg-black/10"
                                            : "text-white/60 hover:text-white hover:bg-white/10"
                                        )}
                                        href={buildTidalUrl(item.id)}
                                        target="_blank"
                                        rel="noreferrer"
                                        onPointerDown={(event) => event.stopPropagation()}
                                        onClick={(event) => event.stopPropagation()}
                                        aria-label={`Open ${item.title} on Tidal`}
                                      >
                                        <svg
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="1.6"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          className="h-4 w-4"
                                          aria-hidden="true"
                                        >
                                          <path d="M14 4h6v6" />
                                          <path d="M10 14L20 4" />
                                          <path d="M20 14v6H4V4h6" />
                                        </svg>
                                      </a>
                                    </TooltipTrigger>
                                    <TooltipContent align="center">Open on Tidal</TooltipContent>
                                  </Tooltip>
                                </div>
                              </div>
                              <p className={cn("text-xs break-words", isSelected ? "text-black/70" : "text-white/60")}>
                                {item.artist.name} · {item.album.title}
                              </p>
                            </div>
                          </label>
                        );
                      })}
                      {match.results.length === 0 && (
                        <p className="text-sm text-white/60 text-pretty">No results found for this track.</p>
                      )}
                    </RadioGroup>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setError(null);
                      setAutoQueueing((prev) => {
                        const next = !prev;
                        if (next) {
                          lastAutoMatchedIndex.current = null;
                          stopAutoQueueIndexRef.current = null;
                          autoQueueOriginIndexRef.current = match.index;
                          autoQueueRunning.current = false;
                        } else {
                          stopAutoQueueIndexRef.current = match.index;
                        }
                        return next;
                      });
                    }}
                    disabled={isLoading}
                  >
                    {autoQueueing ? "Stop auto-queue" : "Auto-queue suggestions"}
                  </Button>
                </div>
                {error && <p className="text-sm text-white/70">{error}</p>}
                <div className="mt-auto border-t border-white/10 pt-4 text-xs text-white/60">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 flex-col gap-1">
                      <span className="uppercase text-[10px] tracking-[0.2em] text-white/40">Current playlist</span>
                      <span className="text-sm text-white/80 break-words">
                        {currentSession?.filename || "Unknown CSV"}
                      </span>
                      <div className="flex flex-wrap gap-3 text-xs text-white/50">
                        <span>{currentSession ? `Hash ${shortHash(currentSession.fileHash)}` : "Hash unavailable"}</span>
                        <span>{activeTotalTracks ? `${activeTotalTracks} tracks` : "Tracks unknown"}</span>
                        <span>{`${activeDownloadCount} saved`}</span>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 flex flex-col md:h-[min(72vh,720px)]">
              <CardHeader className="flex flex-col gap-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex flex-col gap-1">
                    <CardTitle className="flex items-center gap-2 text-balance font-serif">
                      Ready to download
                      {autoQueueing && (
                        <span
                          className="size-4 animate-spin rounded-full border-2 border-white/40 border-t-white"
                          title="Auto-queue running"
                          aria-label="Auto-queue running"
                        />
                      )}
                    </CardTitle>
                    <span className="text-xs text-white/60 tabular-nums">{downloads.length.toLocaleString()} queued</span>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={downloadZip}
                      disabled={downloads.length === 0 || zipDownloading}
                    >
                      Download zip
                    </Button>
                  </div>
                </div>
                <CardDescription className="text-pretty">
                  Download any saved matches. Browser-side conversion handles MPD manifests with FFmpeg.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col gap-4 md:min-h-0">
                {downloads.length === 0 && (
                  <p className="text-sm text-white/60 text-pretty">Save a match to see downloads here.</p>
                )}
                {downloads.length > 0 && (
                  <>
                    <div className="relative">
                      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-white/50">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="h-4 w-4"
                          aria-hidden="true"
                        >
                          <circle cx="11" cy="11" r="7" />
                          <path d="M20 20l-3.5-3.5" />
                        </svg>
                      </span>
                      <Input
                        value={downloadSearch}
                        onChange={(event) => setDownloadSearch(event.target.value)}
                        placeholder="Search saved tracks"
                        aria-label="Search saved tracks"
                        className="pl-9 pr-10"
                      />
                      {downloadSearch.trim() && (
                        <button
                          type="button"
                          className="absolute right-2 top-1/2 -translate-y-1/2 flex h-6 w-6 items-center justify-center rounded-full text-white/60 transition hover:bg-white/10 hover:text-white"
                          onClick={() => setDownloadSearch("")}
                          aria-label="Clear search"
                        >
                          <svg
                            viewBox="0 0 24 24"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.8"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="h-4 w-4"
                            aria-hidden="true"
                          >
                            <path d="M18 6L6 18" />
                            <path d="M6 6l12 12" />
                          </svg>
                        </button>
                      )}
                    </div>
                    {filteredDownloads.length === 0 && (
                      <p className="text-sm text-white/60 text-pretty">No saved tracks match this search.</p>
                    )}
                    {filteredDownloads.length > 0 && (
                      <>
                        <div className="flex flex-col gap-2 md:hidden" role="list">
                          {filteredDownloads.map((entry) => {
                            const key = createDownloadKey(entry.index, entry.item.id);
                            return (
                              <div key={key} className="px-1 py-1" role="listitem">
                                <DownloadRowCard
                                  entry={entry}
                                  buildDownloadKey={buildDownloadKey}
                                  downloadStatus={downloadStatus}
                                  isLoading={isLoading}
                                  onOpenMatch={openDownloadMatch}
                                  onDownload={handleDownloadEntry}
                                  onRemove={removeDownload}
                                />
                              </div>
                            );
                          })}
                        </div>
                        <div className="hidden md:flex md:min-h-0 md:flex-1">
                          <AutoSizer>
                            {({ height, width }) => (
                              <List
                                className="scroll-area md:pr-2"
                                rowCount={filteredDownloads.length}
                                rowHeight={DOWNLOAD_ROW_HEIGHT}
                                rowComponent={DownloadRow}
                                rowProps={{ data: downloadRowData }}
                                style={{ height, width }}
                              />
                            )}
                          </AutoSizer>
                        </div>
                      </>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </div>
        )}
      </>
    ) : null;

  const homeRoute = (
    <>
      {!sessionId && (
        <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
          <Card>
            <CardHeader>
              <CardTitle className="text-balance font-serif">Upload your Spotify CSV</CardTitle>
              <CardDescription className="text-pretty">
                The CSV should match the existing structure: track URI, track name, album name, artist name, and release date.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-xs text-white/70">
                <p className="text-pretty font-medium text-white/80">How to get the CSV</p>
                <p className="text-pretty">
                  Visit <a className="underline" href="https://exportify.net/">exportify.net</a>, connect Spotify, export your liked songs, and
                  save the file as <span className="font-semibold">Liked_Songs.csv</span>.
                </p>
              </div>
              <Input
                type="file"
                accept=".csv"
                aria-label="Upload CSV file"
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  if (file) {
                    void handleFileUpload(file);
                  }
                }}
              />
              {error && <p className="text-sm text-white/70">{error}</p>}
              <div className="text-xs text-white/60">
                <p className="text-pretty">Once uploaded, we search one track at a time so you can cherry-pick the exact match.</p>
              </div>
            </CardContent>
          </Card>
          <Card className="flex flex-col md:max-h-[min(72vh,720px)]">
            <CardHeader>
              <CardTitle className="text-balance font-serif">Recent CSVs</CardTitle>
              <CardDescription className="text-pretty">Resume past sessions and keep each download queue separate.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-1 min-h-0 flex-col gap-4">
              {sessions.length === 0 && <p className="text-sm text-white/60 text-pretty">Upload a CSV to start tracking recent files.</p>}
              {sessions.length > 0 && (
                <div className="scroll-area flex min-h-0 flex-1 flex-col gap-3 md:overflow-y-auto md:pr-2">
                  {sessions.map((session) => {
                    const lastUpdated = new Date(session.updatedAt);
                    return (
                      <div
                        key={session.id}
                        className={cn(
                          "flex flex-col gap-2 rounded-lg border px-4 py-3",
                          session.id === activeSessionId ? "border-white/40 bg-white/10" : "border-white/10 bg-white/5"
                        )}
                      >
                        <div className="flex flex-wrap items-start justify-between gap-3">
                          <div className="flex min-w-0 flex-col gap-1">
                            <p className="text-sm font-medium text-white break-words">{session.filename || "Unknown CSV"}</p>
                            <p className="text-xs text-white/60">Hash {shortHash(session.fileHash)}</p>
                            <div className="flex flex-wrap gap-3 text-xs text-white/50">
                              <span>{lastUpdated.toLocaleString()}</span>
                              <span>{`${session.totalTracks} tracks`}</span>
                              <span>{session.downloadCount} saved</span>
                            </div>
                          </div>
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                restoreAttemptedSessionIdRef.current = null;
                                replaceSearchParams({ sessionId: session.id });
                              }}
                              disabled={isLoading}
                            >
                              Resume
                            </Button>
                            <Button size="sm" variant="ghost" onClick={() => void clearSession(session.id)} disabled={isLoading}>
                              Clear
                            </Button>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}
      {sessionPanel}
    </>
  );

  return (
    <TooltipProvider delayDuration={200}>
      <div className="min-h-dvh overflow-x-hidden bg-zinc-950 text-white md:h-dvh md:overflow-hidden">
        <div className="mx-auto flex min-h-dvh w-full max-w-6xl flex-col justify-start md:h-full md:justify-center gap-8 px-6 py-10 box-border">
        <header className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div className="flex flex-col gap-2">
              <h1 className="text-balance text-4xl font-semibold font-serif">Striker</h1>
              <p className="text-pretty text-sm text-white/70">
                Convert your Spotify playlists into pristine lossless Tidal FLAC downloads.
              </p>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleUploadClick}
                className={cn(buttonVariants({ size: "sm", variant: "ghost" }), "text-white/70 hover:text-white")}
              >
                Upload
              </button>
              <Dialog open={settingsOpen} onOpenChange={handleSettingsOpenChange}>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <DialogTrigger asChild>
                      <Button size="icon" variant="outline" aria-label="Open download settings" className="shrink-0">
                        <svg
                          viewBox="0 0 24 24"
                          fill="none"
                          stroke="currentColor"
                          strokeWidth="1.6"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          className="size-4"
                          aria-hidden="true"
                        >
                          <circle cx="12" cy="12" r="3" />
                          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9c0 .66.39 1.26 1 1.51H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z" />
                        </svg>
                      </Button>
                    </DialogTrigger>
                  </TooltipTrigger>
                  <TooltipContent>Settings</TooltipContent>
                </Tooltip>
                <DialogContent className="flex flex-col">
                  <DialogHeader>
                    <DialogTitle>Download settings</DialogTitle>
                    <DialogDescription>
                      Set separate naming templates for single downloads and zip builds. Use "/" to create folders in zip
                      downloads; single downloads only use the final filename segment.
                    </DialogDescription>
                  </DialogHeader>
                  <div className="scroll-area mt-4 flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto pr-1">
                    <div className="flex flex-col gap-2">
                      <p className="text-xs uppercase text-white/50">Single downloads</p>
                      <p className="text-xs text-pretty text-white/60">
                        Used when you download one track. Only the filename segment is applied.
                      </p>
                      <label className="text-xs uppercase text-white/50" htmlFor="single-download-template">
                        Single download template
                      </label>
                      <Input
                        id="single-download-template"
                        value={singleTemplateDraft}
                        onChange={(event) => setSingleTemplateDraft(event.target.value)}
                        aria-invalid={Boolean(singleTemplateError)}
                        aria-describedby={singleTemplateError ? "single-download-template-error" : "single-download-template-help"}
                        placeholder={DEFAULT_SINGLE_DOWNLOAD_TEMPLATE}
                      />
                      <p id="single-download-template-help" className="text-xs text-pretty text-white/60">
                        Keep the .flac extension at the end of the filename.
                      </p>
                      {singleTemplateError && (
                        <p id="single-download-template-error" className="text-xs text-pretty text-rose-200">
                          {singleTemplateError}
                        </p>
                      )}
                      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                        <p className="text-xs uppercase text-white/50">Filename preview</p>
                        <p className="mt-2 text-sm text-white/80 font-mono tabular-nums break-words">
                          {singleTemplatePreview ?? "Preview updates once the template is valid."}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-col gap-2">
                      <p className="text-xs uppercase text-white/50">Zip downloads</p>
                      <p className="text-xs text-pretty text-white/60">Used to build folder paths inside the zip archive.</p>
                      <label className="text-xs uppercase text-white/50" htmlFor="zip-download-template">
                        Zip download template
                      </label>
                      <Input
                        id="zip-download-template"
                        value={zipTemplateDraft}
                        onChange={(event) => setZipTemplateDraft(event.target.value)}
                        aria-invalid={Boolean(zipTemplateError)}
                        aria-describedby={zipTemplateError ? "zip-download-template-error" : "zip-download-template-help"}
                        placeholder={DEFAULT_ZIP_DOWNLOAD_TEMPLATE}
                      />
                      <p id="zip-download-template-help" className="text-xs text-pretty text-white/60">
                        Use "/" to create folders. Keep the .flac extension at the end of the path.
                      </p>
                      {zipTemplateError && (
                        <p id="zip-download-template-error" className="text-xs text-pretty text-rose-200">
                          {zipTemplateError}
                        </p>
                      )}
                      <div className="flex items-center gap-3 text-sm text-white/80">
                        <Checkbox
                          id="include-album-cover"
                          checked={includeAlbumCoverDraft}
                          onCheckedChange={(value: boolean | "indeterminate") => setIncludeAlbumCoverDraft(Boolean(value))}
                        />
                        <label htmlFor="include-album-cover" className="text-sm">
                          Include album cover.jpg
                        </label>
                      </div>
                      <p className="text-xs text-pretty text-white/60">
                        Adds a cover.jpg file to each album folder when creating zip downloads.
                      </p>
                      <div className="rounded-lg border border-white/10 bg-white/5 px-4 py-3">
                        <p className="text-xs uppercase text-white/50">Zip path preview</p>
                        <p className="mt-2 text-sm text-white/80 font-mono tabular-nums break-words">
                          {zipPathPreview ?? "Preview updates once the template is valid."}
                        </p>
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 text-xs text-white/60">
                      <span>Need the full token list?</span>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        className="h-7 px-2 text-[11px]"
                        onClick={() => setTokenDialogOpen(true)}
                      >
                        View tokens
                      </Button>
                    </div>
                  </div>
                  <DialogFooter className="mt-6 border-t border-white/10 pt-4">
                    <DialogClose asChild>
                      <Button variant="ghost">Cancel</Button>
                    </DialogClose>
                    <Button onClick={handleSaveTemplate} disabled={!singleTemplateValidation.ok || !zipTemplateValidation.ok}>
                      Save settings
                    </Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={tokenDialogOpen} onOpenChange={setTokenDialogOpen}>
                <DialogContent className="flex max-h-[80vh] flex-col">
                  <DialogHeader>
                    <DialogTitle>Template tokens</DialogTitle>
                    <DialogDescription>Use these placeholders to build folder paths and filenames.</DialogDescription>
                  </DialogHeader>
                  <div className="scroll-area mt-4 flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto pr-1">
                    <div className="grid gap-3 sm:grid-cols-2">
                      {TEMPLATE_TOKENS.map((token) => (
                        <div key={token.token} className="rounded-lg border border-white/10 bg-zinc-950/60 px-3 py-2">
                          <p className="text-xs font-medium text-white/80">{`{{${token.token}}}`}</p>
                          <p className="text-xs text-pretty text-white/60">{token.description}</p>
                          <p className="text-[11px] text-white/50 tabular-nums">{token.example}</p>
                        </div>
                      ))}
                    </div>
                  </div>
                  <DialogFooter className="mt-6 border-t border-white/10 pt-4">
                    <DialogClose asChild>
                      <Button variant="ghost">Close</Button>
                    </DialogClose>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
              <Dialog open={zipCancelOpen} onOpenChange={setZipCancelOpen}>
                <DialogContent>
                  <DialogHeader>
                    <DialogTitle>Cancel zip download?</DialogTitle>
                    <DialogDescription>
                      This will stop the current zip build. Any progress so far will be discarded.
                    </DialogDescription>
                  </DialogHeader>
                  <DialogFooter className="mt-4 gap-2 sm:gap-0">
                    <DialogClose asChild>
                      <Button variant="ghost">Keep zipping</Button>
                    </DialogClose>
                    <Button onClick={confirmZipCancel}>Cancel zip</Button>
                  </DialogFooter>
                </DialogContent>
              </Dialog>
            </div>
          </div>
        </header>

        {homeRoute}

        </div>
      </div>
      <Toast
        open={zipToast.open}
        title={zipToast.title}
        description={zipToast.description}
        progress={zipToast.progress}
        action={
          zipDownloading ? (
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-xs"
              onClick={requestZipCancel}
              disabled={zipCancelRequested}
            >
              {zipCancelRequested ? "Cancelling..." : "Cancel"}
            </Button>
          ) : null
        }
      />
      <Toast
        open={ffmpegToast.open}
        title={ffmpegToast.title}
        description={ffmpegToast.description}
        progress={ffmpegToast.progress}
      />
    </TooltipProvider>
  );
}

export default AppClient;
