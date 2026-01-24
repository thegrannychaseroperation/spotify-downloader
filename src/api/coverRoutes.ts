import { corsHeaders } from "./cors";

const ALLOWED_HOSTS = new Set(["resources.tidal.com"]);

function resolveCoverUrl(rawUrl: string | null): URL | null {
  if (!rawUrl) return null;
  try {
    const url = new URL(rawUrl);
    if (url.protocol !== "https:") return null;
    if (!ALLOWED_HOSTS.has(url.hostname)) return null;
    return url;
  } catch {
    return null;
  }
}

export async function handleCoverRoutes(request: Request, url: URL): Promise<Response | null> {
  if (url.pathname !== "/api/cover" || request.method !== "GET") {
    return null;
  }

  const coverUrl = resolveCoverUrl(url.searchParams.get("url"));
  if (!coverUrl) {
    return new Response("Invalid cover URL.", { status: 400, headers: corsHeaders });
  }

  try {
    const response = await fetch(coverUrl.toString());
    if (!response.ok || !response.body) {
      return new Response("Cover download failed.", { status: 502, headers: corsHeaders });
    }

    const headers = new Headers({
      ...corsHeaders,
      "Content-Type": response.headers.get("Content-Type") ?? "image/jpeg",
      "Cache-Control": "public, max-age=86400",
    });

    return new Response(response.body, { status: 200, headers });
  } catch (error) {
    console.warn(`⚠️ Cover proxy failed: ${error}`);
    return new Response("Cover proxy failed.", { status: 502, headers: corsHeaders });
  }
}
