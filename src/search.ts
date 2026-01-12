import { JSDOM } from "jsdom";
import { LUCIDA_SEARCH_BASE_URL } from "./config";

function buildSearchQuery(artistName: string, trackName: string): string {
  const query = `${artistName} ${trackName}`.trim();
  return encodeURIComponent(query.replace(/\s+/g, "+"));
}

function buildSearchUrl(artistName: string, trackName: string, country: string = "US"): string {
  const query = buildSearchQuery(artistName, trackName);
  return `${LUCIDA_SEARCH_BASE_URL}?service=tidal&country=${country}&query=${query}`;
}

export async function searchTrack(artistName: string, trackName: string): Promise<{ tidalUrl: string | null; html: string }> {
  const searchUrl = buildSearchUrl(artistName, trackName);
  console.log(`Searching for: ${artistName} - ${trackName}`);
  console.log(`Search URL: ${searchUrl}`);

  try {
    const response = await fetch(searchUrl, {
      headers: {
        "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36",
      },
    });

    if (!response.ok) {
      console.error(`Search failed: ${response.status} ${response.statusText}`);
      return { tidalUrl: null, html: "" };
    }

    const html = await response.text();
    
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    const firstResult = document.querySelector(".search-result-track");
    
    if (!firstResult) {
      console.log("No search results found");
      return { tidalUrl: null, html };
    }
    
    const h1Element = firstResult.querySelector("a > h1");
    const anchor = h1Element?.parentElement;
    
    if (!anchor || anchor.tagName !== "A") {
      console.log("No anchor with href found in first result");
      return { tidalUrl: null, html };
    }
    
    const href = (anchor as Element).getAttribute("href");
    if (!href) {
      console.log("No href attribute found in anchor");
      return { tidalUrl: null, html };
    }
    
    try {
      const urlObj = new URL(href, "https://lucida.to");
      const encodedUrl = urlObj.searchParams.get("url");
      
      if (!encodedUrl) {
        console.log("No url parameter found in anchor href");
        return { tidalUrl: null, html };
      }
      
      const tidalUrl = decodeURIComponent(encodedUrl);
      console.log(`Found Tidal URL: ${tidalUrl}`);
      return { tidalUrl, html };
    } catch (urlError) {
      console.error(`Error parsing URL: ${urlError}`);
      return { tidalUrl: null, html };
    }
  } catch (error) {
    console.error(`Error searching for track: ${error}`);
    return { tidalUrl: null, html: "" };
  }
}
