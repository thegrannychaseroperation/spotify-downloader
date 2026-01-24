export type ManifestResult =
  | { kind: "url"; url: string }
  | { kind: "mpd"; buffer: Uint8Array };

type ManifestPayload = {
  mimeType: string;
  codecs: string;
  encryptionType: string;
  urls: string[];
};

type SegmentTemplate = {
  initialization: string;
  media: string;
  startNumber: number;
  timeline: Array<{ d: number; r: number }>;
};

export type SegmentUrls = {
  initialization: string;
  segments: string[];
};

export function decodeManifest(manifest: string): ManifestResult | null {
  const decodedBuffer = Buffer.from(manifest, "base64");
  const decodedText = decodedBuffer.toString("utf8").trim();
  if (decodedText.startsWith("<")) {
    return { kind: "mpd", buffer: decodedBuffer };
  }

  try {
    const payload = JSON.parse(decodedText) as ManifestPayload;
    const url = payload.urls?.[0];
    if (!url) {
      return null;
    }

    return { kind: "url", url };
  } catch {
    return null;
  }
}

export function parseMpdSegmentUrls(mpdText: string): SegmentUrls | null {
  const templateMatch = mpdText.match(/<SegmentTemplate\s+([^>]+)>/);
  if (!templateMatch?.[1]) {
    return null;
  }

  const templateAttributes = parseAttributes(templateMatch[1]);
  const initialization = templateAttributes.initialization;
  const media = templateAttributes.media;
  const startNumber = Number(templateAttributes.startNumber ?? "1");

  if (!initialization || !media) {
    return null;
  }

  const timelineMatch = mpdText.match(/<SegmentTimeline>([\s\S]*?)<\/SegmentTimeline>/);
  if (!timelineMatch?.[1]) {
    return null;
  }

  const timeline: Array<{ d: number; r: number }> = [];
  for (const match of timelineMatch[1].matchAll(/<S\s+([^/>]+)\/?\s*>/g)) {
    if (!match[1]) continue;
    const attrs = parseAttributes(match[1]);
    const d = Number(attrs.d ?? "0");
    const r = Number(attrs.r ?? "0");
    if (!Number.isFinite(d) || d <= 0) continue;
    timeline.push({ d, r: Number.isFinite(r) ? r : 0 });
  }

  if (timeline.length === 0) {
    return null;
  }

  const segmentUrls = buildSegmentUrls({
    initialization,
    media,
    startNumber: Number.isFinite(startNumber) && startNumber > 0 ? startNumber : 1,
    timeline,
  });

  return segmentUrls;
}

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {};
  const regex = /(\w+)="([^"]*)"/g;
  let match: RegExpExecArray | null;

  while ((match = regex.exec(source))) {
    const key = match[1];
    if (key) {
      attributes[key] = match[2] ?? "";
    }
  }

  return attributes;
}

function buildSegmentUrls(template: SegmentTemplate): SegmentUrls | null {
  if (!template.media.includes("$Number$")) {
    return null;
  }

  const segments: string[] = [];
  let currentNumber = template.startNumber;

  for (const entry of template.timeline) {
    const repeat = entry.r >= 0 ? entry.r + 1 : 1;
    for (let i = 0; i < repeat; i++) {
      segments.push(template.media.replace("$Number$", String(currentNumber)));
      currentNumber++;
    }
  }

  return {
    initialization: template.initialization,
    segments,
  };
}
