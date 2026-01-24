export type Track = {
  trackUri: string;
  trackName: string;
  albumName: string;
  artistName: string;
  releaseDate: string;
  [key: string]: string;
};

export type TrackListEntry = {
  index: number;
  track: Track;
};

export type TrackListResponse = {
  tracks: TrackListEntry[];
};

export type SearchTrackItem = {
  id: number;
  title: string;
  trackNumber?: number;
  artist: {
    name: string;
  };
  album: {
    title: string;
    cover?: string | null;
  };
};

export type DownloadEntry = {
  index: number;
  track: Track;
  item: SearchTrackItem;
};

export type SessionResponse = {
  sessionId: string;
  totalTracks: number;
};

export type MatchResponse = {
  done: boolean;
  index: number;
  total: number;
  track: Track | null;
  results: SearchTrackItem[];
  suggestedId: number | null;
};

export type SessionSummary = {
  id: string;
  fileHash: string;
  filename: string;
  createdAt: string;
  updatedAt: string;
  totalTracks: number;
  currentIndex: number;
  downloadCount: number;
};
