export interface LoadResponse {
  success: boolean;
  handoff: string;
  name: string;
  stats: {
    service: string;
    account: string;
  };
  fromExternal: boolean;
  server: string;
}

export interface PollResponse {
  success: boolean;
  status: string;
  message: string;
}

export interface Track {
  trackUri: string;
  trackName: string;
  albumName: string;
  artistName: string;
  releaseDate: string;
  [key: string]: string;
}
