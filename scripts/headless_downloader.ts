import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_FILE = path.join(process.cwd(), 'sora_movies.txt');
const DOWNLOAD_DIR = path.join(process.cwd(), 'downloads');
const DYYSY_CDN_BASE = "https://oscdn2.dyysy.com/MP4";

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

const extractId = (url: string): string | null => {
    // Try matching standard share URL format: .../p/ID
    const matchP = url.match(/\/p\/([a-zA-Z0-9_\-]+)/);
    if (matchP) return matchP[1];

    // Try matching direct CDN URL format: .../MP4/ID.mp4
    const matchCDN = url.match(/\/MP4\/([a-zA-Z0-9_\-]+)\.mp4/);
    if (matchCDN) return matchCDN[1];

    return null;
};

const downloadVideo = async (url: string) => {
    const id = extractId(url);
    if (!id) {
        console.error(`❌ Could not extract ID from URL: ${url}`);
        return;
    }

    const cdnUrl = `${DYYSY_CDN_BASE}/${id}.mp4`;
    const outputPath = path.join(DOWNLOAD_DIR, `Sora_${id}.mp4`);

    if (fs.existsSync(outputPath)) {
        console.log(`⏭️  Skipping existing file: ${id}`);
        return;
    }

    console.log(`⬇️  Downloading ${id}...`);

    try {
        const response = await fetch(cdnUrl);

        if (response.status === 404) throw new Error("File not found on CDN (404)");
        if (!response.ok) throw new Error(`Network error (${response.status})`);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length === 0) {
            throw new Error("Downloaded file is empty");
        }

        fs.writeFileSync(outputPath, buffer);
        console.log(`✅ Success: ${id} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

    } catch (error: any) {
        console.error(`❌ Error downloading ${id}: ${error.message}`);
    }
};

const main = async () => {
    console.log("🚀 Starting Headless Sora Batch Downloader");

    if (!fs.existsSync(INPUT_FILE)) {
        console.error(`❌ Input file not found: ${INPUT_FILE}`);
        process.exit(1);
    }

    const content = fs.readFileSync(INPUT_FILE, 'utf-8');
    const urls = content.split(/[\n,]+/).map(line => line.trim()).filter(line => line.length > 0);

    console.log(`📋 Found ${urls.length} URLs to process`);

    for (const url of urls) {
        await downloadVideo(url);
    }

    console.log("🎉 Batch download process completed.");
};

main();
