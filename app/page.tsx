import AppClient from "../components/AppClient";
import { getSessionSnapshot } from "../src/api/sessionRoutes";
import { listWebSessions } from "../src/db";

export const dynamic = "force-dynamic";

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

function resolveParam(value?: string | string[]): string | null {
  if (!value) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

export default async function Page({ searchParams }: PageProps) {
  const sessions = await listWebSessions();
  const resolvedSearchParams = searchParams ? await searchParams : {};
  const sessionId = resolveParam(resolvedSearchParams.sessionId);
  const indexValue = resolveParam(resolvedSearchParams.index);
  const indexOverride = indexValue ? Number(indexValue) : null;
  const sessionSnapshot = sessionId ? await getSessionSnapshot(sessionId, indexOverride) : null;
  const resolvedSessionId = sessionSnapshot ? sessionId : null;

  return (
    <AppClient
      initialSessions={sessions}
      initialSessionId={resolvedSessionId}
      initialMatch={sessionSnapshot?.match ?? null}
      initialDownloads={sessionSnapshot?.downloads ?? []}
    />
  );
}
