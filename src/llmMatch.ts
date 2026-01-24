import OpenAI from "openai";

import {
  MATCH_CANDIDATE_LIMIT,
  MATCH_CONFIDENCE_THRESHOLD,
  OLLAMA_API_KEY,
  OLLAMA_BASE_URL,
  OLLAMA_MODEL,
} from "./config";
import type { SearchTrackItem } from "./search";
import type { Track } from "./types";

type LlmMatchOutcome =
  | { kind: "match"; item: SearchTrackItem; confidence: number; reason?: string }
  | { kind: "none"; confidence: number; reason?: string };

type LlmResponse = {
  kind: "match" | "none";
  id?: number;
  confidence: number;
  reason?: string;
};

const client = new OpenAI({
  apiKey: OLLAMA_API_KEY,
  baseURL: OLLAMA_BASE_URL,
});

const SYSTEM_PROMPT =
  "You are a precise music metadata matcher. Choose the best candidate id only if it" +
  " clearly refers to the same recording and release as the target track. Favor exact" +
  " artist, title, and album matches. Avoid live, remaster, deluxe, instrumental," +
  " karaoke, cover, or alternate versions unless the target explicitly indicates them." +
  " If no candidate is a confident match, respond with kind=none. Return JSON only.";

function extractJson(content: string): string | null {
  const start = content.indexOf("{");
  const end = content.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  return content.slice(start, end + 1);
}

function clampConfidence(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }

  return Math.min(1, Math.max(0, value));
}

function parseLlmResponse(content: string): LlmResponse | null {
  const json = extractJson(content);
  if (!json) {
    return null;
  }

  try {
    const parsed = JSON.parse(json) as LlmResponse;
    if (parsed.kind !== "match" && parsed.kind !== "none") {
      return null;
    }

    if (parsed.kind === "match" && typeof parsed.id !== "number") {
      return null;
    }

    if (typeof parsed.confidence !== "number") {
      return null;
    }

    return {
      ...parsed,
      confidence: clampConfidence(parsed.confidence),
    };
  } catch {
    return null;
  }
}

function formatTrackForPrompt(track: Track): string {
  const releaseYear = track.releaseDate?.slice(0, 4) || "unknown";
  return [
    `artist: ${track.artistName}`,
    `title: ${track.trackName}`,
    `album: ${track.albumName}`,
    `releaseYear: ${releaseYear}`,
  ].join("\n");
}

function formatCandidatesForPrompt(items: SearchTrackItem[]): string {
  return items
    .map((item, index) => {
      const trackNumber = item.trackNumber ?? "unknown";
      return [
        `${index + 1}. id: ${item.id}`,
        `artist: ${item.artist.name}`,
        `title: ${item.title}`,
        `album: ${item.album.title}`,
        `trackNumber: ${trackNumber}`,
      ].join(" | ");
    })
    .join("\n");
}

export async function resolveLlmMatch(track: Track, items: SearchTrackItem[]): Promise<LlmMatchOutcome | null> {
  if (items.length === 0) {
    return null;
  }

  const limitedItems = items.slice(0, MATCH_CANDIDATE_LIMIT);
  const prompt = [
    "Target track:",
    formatTrackForPrompt(track),
    "",
    `Candidates (top ${MATCH_CANDIDATE_LIMIT}):`,
    formatCandidatesForPrompt(limitedItems),
    "",
    "Respond with strict JSON:",
    "{\"kind\":\"match\",\"id\":123,\"confidence\":0.0-1.0,\"reason\":\"short\"}",
    "or",
    "{\"kind\":\"none\",\"confidence\":0.0-1.0,\"reason\":\"short\"}",
  ].join("\n");

  const completion = await client.chat.completions.create({
    model: OLLAMA_MODEL,
    messages: [
      { role: "system", content: SYSTEM_PROMPT },
      { role: "user", content: prompt },
    ],
    temperature: 0.2,
  });

  const content = completion.choices[0]?.message?.content?.trim();
  if (!content) {
    return null;
  }

  const parsed = parseLlmResponse(content);
  if (!parsed) {
    return null;
  }

  if (parsed.kind === "none") {
    return {
      kind: "none",
      confidence: parsed.confidence,
      reason: parsed.reason,
    };
  }

  const matched = limitedItems.find((item) => item.id === parsed.id);
  if (!matched) {
    return null;
  }

  return {
    kind: "match",
    item: matched,
    confidence: parsed.confidence,
    reason: parsed.reason,
  };
}

export function shouldAutoSelect(confidence: number): boolean {
  return confidence >= MATCH_CONFIDENCE_THRESHOLD;
}
