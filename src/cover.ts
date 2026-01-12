import { JSDOM } from "jsdom";

export function extractCoverImageUrl(html: string): string | null {
  try {
    const dom = new JSDOM(html);
    const document = dom.window.document;
    
    const anchors = document.querySelectorAll("a");
    for (const anchor of anchors) {
      const title = anchor.getAttribute("title");
      if (title === "Click for full quality cover (unproxied).") {
        const href = anchor.getAttribute("href");
        if (href) {
          if (href.startsWith("http")) {
            return href;
          } else {
            return new URL(href, "https://lucida.to").href;
          }
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error(`Error extracting cover image URL: ${error}`);
    return null;
  }
}

export async function downloadCoverImage(coverUrl: string, albumFolderPath: string): Promise<void> {
  const coverPath = `${albumFolderPath}cover.jpg`;
  
  const coverFile = Bun.file(coverPath);
  if (await coverFile.exists()) {
    console.log(`Cover image already exists, skipping download`);
    return;
  }

  try {
    const response = await fetch(coverUrl);
    
    if (!response.ok) {
      throw new Error(`Failed to download cover image: ${response.status} ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    await Bun.write(coverPath, arrayBuffer);
    
    console.log(`Cover image saved as: ${coverPath}`);
  } catch (error) {
    console.error(`Error downloading cover image: ${error}`);
  }
}
