import { corsHeaders } from "./cors";
import { handleCoverRoutes } from "./coverRoutes";
import { handleDownloadRoutes } from "./downloadRoutes";
import { handleSessionRoutes } from "./sessionRoutes";

export async function handleApiRequest(request: Request): Promise<Response> {
  const url = new URL(request.url);

  if (request.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  const downloadResponse = await handleDownloadRoutes(request, url);
  if (downloadResponse) {
    return downloadResponse;
  }

  const coverResponse = await handleCoverRoutes(request, url);
  if (coverResponse) {
    return coverResponse;
  }

  const sessionResponse = await handleSessionRoutes(request, url);
  if (sessionResponse) {
    return sessionResponse;
  }

  return new Response("Not found.", { status: 404, headers: corsHeaders });
}
