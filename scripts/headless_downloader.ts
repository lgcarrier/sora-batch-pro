import fs from 'fs';
import path from 'path';
import {
    buildDownloadFilename,
    getDownloadAsset,
    isSupportedSoraInput,
    normalizeSoraInput,
    resolveSoraVideo,
} from '../services/dyysyService.ts';

const INPUT_FILE = path.join(process.cwd(), 'sora_movies.txt');
const DOWNLOAD_DIR = path.join(process.cwd(), 'downloads');

// Ensure download directory exists
if (!fs.existsSync(DOWNLOAD_DIR)) {
    fs.mkdirSync(DOWNLOAD_DIR);
}

const downloadVideo = async (url: string) => {
    const normalizedInput = normalizeSoraInput(url);
    if (!normalizedInput || !isSupportedSoraInput(normalizedInput)) {
        console.error(`❌ Unsupported Sora input: ${url}`);
        return;
    }

    console.log(`🔎 Resolving via Dyysy backend: ${normalizedInput}`);

    try {
        const resolved = await resolveSoraVideo(normalizedInput);
        const asset = getDownloadAsset(resolved, 'mp4');
        const outputPath = path.join(DOWNLOAD_DIR, buildDownloadFilename(resolved, 'mp4'));
        const label = resolved.mediaId || normalizedInput;

        if (fs.existsSync(outputPath)) {
            console.log(`⏭️  Skipping existing file: ${path.basename(outputPath)}`);
            return;
        }

        console.log(`⬇️  Downloading ${label}...`);

        const response = await fetch(asset.url);

        if (response.status === 404) throw new Error("File not found on resolved media URL (404)");
        if (!response.ok) throw new Error(`Network error (${response.status})`);

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        if (buffer.length === 0) {
            throw new Error("Downloaded file is empty");
        }

        fs.writeFileSync(outputPath, buffer);
        console.log(`✅ Success: ${path.basename(outputPath)} (${(buffer.length / 1024 / 1024).toFixed(2)} MB)`);

    } catch (error: any) {
        console.error(`❌ Error downloading ${normalizedInput}: ${error.message}`);
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
