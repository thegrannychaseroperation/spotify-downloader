export interface Track {
  trackUri: string;
  trackName: string;
  albumName: string;
  artistName: string;
  releaseDate: string;
  [key: string]: string;
}
