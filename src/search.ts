import { SEARCH_API_BASE_URL } from "./config";

type SearchResponse = {
  version: string;
  data: {
    limit: number;
    offset: number;
    totalNumberOfItems: number;
    items: SearchTrackItem[];
  };
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

export async function searchTracks(query: string): Promise<SearchTrackItem[]> {
  const url = `${SEARCH_API_BASE_URL}/?s=${encodeURIComponent(query)}`;
  const response = await fetch(url);

  if (!response.ok) {
    throw new Error(`Search request failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as SearchResponse;
  return data.data.items ?? [];
}
