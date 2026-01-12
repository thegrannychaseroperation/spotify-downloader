import { readCSVFile } from "./csv";
import { getAlbumFolderPath, isTrackAlreadyDownloaded } from "./filesystem";
import { initiateDownload, pollUntilCompleted, downloadFile } from "./api";
import { searchTrack } from "./search";
import { extractCoverImageUrl, downloadCoverImage } from "./cover";
import { CSV_FILE_PATH, TOKEN } from "./config";
import type { Track } from "./types";

async function downloadTrack(tidalUrl: string, albumFolderPath: string | null, track: Track): Promise<void> {
  try {
    const { handoff, server } = await initiateDownload(tidalUrl, TOKEN);
    await pollUntilCompleted(server, handoff);
    await downloadFile(server, handoff, albumFolderPath, track);
  } catch (error) {
    throw new Error(`Failed to download track ${track.artistName} - ${track.trackName}: ${error}`);
  }
}

async function processAllTracks(): Promise<void> {
  console.log("Reading CSV file...");
  const tracks = await readCSVFile(CSV_FILE_PATH);
  console.log(`Found ${tracks.length} tracks in CSV\n`);
  
  let found = 0;
  let notFound = 0;
  let downloaded = 0;
  let downloadFailed = 0;
  let skipped = 0;
  
  for (let i = 0; i < tracks.length; i++) {
    const track = tracks[i];
    if (!track) continue;
    
    console.log(`\n[${i + 1}/${tracks.length}] Processing: ${track.artistName} - ${track.trackName}`);
    
    try {
      const albumFolderPath = getAlbumFolderPath(track);
      
      const alreadyDownloaded = await isTrackAlreadyDownloaded(track, albumFolderPath);
      if (alreadyDownloaded) {
        console.log(`⏭ Already downloaded, skipping`);
        skipped++;
        continue;
      }
      
      const { tidalUrl, html } = await searchTrack(track.artistName, track.trackName);
      
      if (tidalUrl) {
        console.log(`✓ Found Tidal URL`);
        found++;
        
        try {
          await downloadTrack(tidalUrl, albumFolderPath, track);
          downloaded++;
          console.log(`✓ Successfully downloaded`);
          
          if (albumFolderPath && html) {
            const coverUrl = extractCoverImageUrl(html);
            if (coverUrl) {
              await downloadCoverImage(coverUrl, albumFolderPath);
            }
          }
        } catch (error) {
          downloadFailed++;
          console.error(`✗ Download failed: ${error}`);
        }
      } else {
        console.log(`✗ No Tidal URL found`);
        notFound++;
      }
    } catch (error) {
      console.error(`✗ Error processing track: ${error}`);
      notFound++;
    }
  }
  
  console.log(`\n=== Summary ===`);
  console.log(`Total tracks: ${tracks.length}`);
  console.log(`Skipped (already downloaded): ${skipped}`);
  console.log(`Found: ${found}`);
  console.log(`Not found: ${notFound}`);
  console.log(`Downloaded: ${downloaded}`);
  console.log(`Download failed: ${downloadFailed}`);
}

async function main() {
  try {
    await processAllTracks();
    console.log("Done!");
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

main();
