import type { Track } from "./types";

export function parseCSV(csvContent: string): Track[] {
  const lines = csvContent.trim().split("\n");
  if (lines.length < 2) {
    return [];
  }

  const firstLine = lines[0];
  if (!firstLine) {
    return [];
  }

  const headers = firstLine.split(",").map((h) => h.trim());
  const tracks: Track[] = [];

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !line.trim()) continue;

    const values: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let j = 0; j < line.length; j++) {
      const char = line[j];
      if (char === '"') {
        inQuotes = !inQuotes;
      } else if (char === "," && !inQuotes) {
        values.push(current);
        current = "";
      } else {
        current += char;
      }
    }
    values.push(current);

    if (values.length < headers.length) {
      continue;
    }

    const track: Track = {
      trackUri: values[0]?.trim() || "",
      trackName: values[1]?.trim().replace(/^"|"$/g, "") || "",
      albumName: values[2]?.trim().replace(/^"|"$/g, "") || "",
      artistName: values[3]?.trim().replace(/^"|"$/g, "") || "",
      releaseDate: values[4]?.trim() || "",
    };

    headers.forEach((header, index) => {
      if (index > 4 && values[index]) {
        track[header] = values[index]?.trim().replace(/^"|"$/g, "") || "";
      }
    });

    tracks.push(track);
  }

  return tracks;
}

export async function readCSVFile(filePath: string): Promise<Track[]> {
  const file = Bun.file(filePath);
  const content = await file.text();
  return parseCSV(content);
}
