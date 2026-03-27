export const DYYSY_API_BASE = 'https://api.dyysy.com';
export const DYYSY_RESOLVER_ROUTE = 'links20260207';

export type DyysyAssetType = 'mp4' | 'mp4_wm' | 'gif' | 'thumbnail' | 'md';

export interface DyysyVideoLinks {
  gif?: string | null;
  gif_source?: string | null;
  md?: string | null;
  md_source?: string | null;
  mp4?: string | null;
  mp4_source?: string | null;
  mp4_wm?: string | null;
  mp4_wm_source?: string | null;
  thumbnail?: string | null;
  thumbnail_source?: string | null;
}

export interface DyysyPostInfo {
  attachments_count?: number | null;
  like_count?: number | null;
  prompt?: string | null;
  remix_count?: number | null;
  title?: string | null;
  view_count?: number | null;
}

interface DyysyResolveResponse {
  error?: string;
  links?: DyysyVideoLinks;
  post_info?: DyysyPostInfo;
}

export interface ResolvedSoraVideo {
  links: DyysyVideoLinks;
  mediaId: string;
  normalizedInput: string;
  postInfo: DyysyPostInfo;
  requestedInput: string;
}

export interface DownloadAsset {
  extension: string;
  label: string;
  suffix: string;
  type: DyysyAssetType;
  url: string;
}

const SUPPORTED_HOSTS = new Set([
  'api.dyysy.com',
  'dyysy.com',
  'oscdn2.dyysy.com',
  'sora.chatgpt.com',
  'videos-us3.ss2.life',
  'videos.openai.com',
  'www.dyysy.com',
]);

const SHARE_ID_PATTERN = /\b(s_[a-z0-9]{16,})\b/i;
const LEGACY_CDN_PATTERN = /\/MP4\/([A-Za-z0-9_-]+)\.mp4/i;
const PATH_ID_PATTERN = /\/p\/([A-Za-z0-9_-]+)/i;
const FILE_ID_PATTERN = /\/files\/([^/?#]+)\//i;

const DOWNLOAD_ASSET_DETAILS: Record<DyysyAssetType, Omit<DownloadAsset, 'type' | 'url'>> = {
  gif: {
    extension: 'gif',
    label: 'GIF',
    suffix: '',
  },
  md: {
    extension: 'mp4',
    label: 'medium MP4',
    suffix: '_medium',
  },
  mp4: {
    extension: 'mp4',
    label: 'no-watermark MP4',
    suffix: '',
  },
  mp4_wm: {
    extension: 'mp4',
    label: 'watermarked MP4',
    suffix: '_with_watermark',
  },
  thumbnail: {
    extension: 'webp',
    label: 'thumbnail',
    suffix: '_thumbnail',
  },
};

const readJsonSafely = (raw: string): DyysyResolveResponse | null => {
  try {
    return JSON.parse(raw) as DyysyResolveResponse;
  } catch {
    return null;
  }
};

const sanitizeFilenamePart = (value?: string | null): string => {
  if (!value) return '';

  return value
    .normalize('NFKD')
    .replace(/[^\x00-\x7F]/g, '')
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 80);
};

const extractFileIdFromLink = (url?: string | null): string | null => {
  if (!url) return null;
  const match = url.match(FILE_ID_PATTERN);
  return match?.[1] ?? null;
};

const getMediaIdFromLinks = (links: DyysyVideoLinks): string | null => {
  return (
    extractFileIdFromLink(links.mp4) ??
    extractFileIdFromLink(links.mp4_wm) ??
    extractFileIdFromLink(links.thumbnail) ??
    extractFileIdFromLink(links.md) ??
    extractFileIdFromLink(links.gif) ??
    null
  );
};

export const normalizeSoraInput = (input: string): string => {
  const trimmed = input.trim();
  if (!trimmed) return '';

  try {
    const parsed = new URL(trimmed);
    if (parsed.hostname === 'dyysy.com' || parsed.hostname === 'www.dyysy.com') {
      const nestedUrl = parsed.searchParams.get('url');
      if (nestedUrl) {
        return normalizeSoraInput(nestedUrl);
      }
    }
  } catch {
    // Ignore non-URL inputs such as raw share IDs or /p/<id> paths.
  }

  return trimmed;
};

export const extractSoraId = (input: string): string | null => {
  const normalized = normalizeSoraInput(input);
  if (!normalized) return null;

  const shareIdMatch = normalized.match(SHARE_ID_PATTERN);
  if (shareIdMatch) return shareIdMatch[1];

  const pathIdMatch = normalized.match(PATH_ID_PATTERN);
  if (pathIdMatch) return pathIdMatch[1];

  const legacyCdnMatch = normalized.match(LEGACY_CDN_PATTERN);
  if (legacyCdnMatch) return legacyCdnMatch[1];

  const fileIdMatch = normalized.match(FILE_ID_PATTERN);
  if (fileIdMatch) return fileIdMatch[1];

  return null;
};

export const isSupportedSoraInput = (input: string): boolean => {
  const normalized = normalizeSoraInput(input);
  if (!normalized) return false;

  if (
    SHARE_ID_PATTERN.test(normalized) ||
    PATH_ID_PATTERN.test(normalized) ||
    LEGACY_CDN_PATTERN.test(normalized) ||
    FILE_ID_PATTERN.test(normalized)
  ) {
    return true;
  }

  try {
    const parsed = new URL(normalized);
    return SUPPORTED_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
};

export const getResolverUrl = (input: string): string => {
  const normalized = normalizeSoraInput(input);
  return `${DYYSY_API_BASE}/${DYYSY_RESOLVER_ROUTE}/${encodeURIComponent(normalized)}`;
};

export const resolveSoraVideo = async (input: string): Promise<ResolvedSoraVideo> => {
  const normalizedInput = normalizeSoraInput(input);
  if (!normalizedInput) {
    throw new Error('A Sora share URL or ID is required.');
  }

  let response: Response;

  try {
    response = await fetch(getResolverUrl(normalizedInput), {
      headers: {
        Accept: 'application/json',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown network error';
    throw new Error(`Unable to reach the Dyysy resolver: ${message}`);
  }

  const raw = await response.text();
  const data = readJsonSafely(raw);

  if (!response.ok || !data?.links) {
    const message =
      data?.error ??
      (raw.trim() ? raw.trim() : `Resolver request failed with status ${response.status}`);

    throw new Error(message);
  }

  const mediaId =
    extractSoraId(normalizedInput) ??
    getMediaIdFromLinks(data.links) ??
    `resolved_${Date.now()}`;

  return {
    links: data.links,
    mediaId,
    normalizedInput,
    postInfo: data.post_info ?? {},
    requestedInput: input,
  };
};

export const getDownloadAsset = (
  resolved: ResolvedSoraVideo,
  type: DyysyAssetType = 'mp4',
): DownloadAsset => {
  const url = resolved.links[type];
  if (!url) {
    throw new Error(`Dyysy did not return a ${DOWNLOAD_ASSET_DETAILS[type].label} link.`);
  }

  return {
    ...DOWNLOAD_ASSET_DETAILS[type],
    type,
    url,
  };
};

export const buildDownloadFilename = (
  resolved: ResolvedSoraVideo,
  type: DyysyAssetType = 'mp4',
): string => {
  const asset = getDownloadAsset(resolved, type);
  const baseId =
    sanitizeFilenamePart(resolved.mediaId) ||
    sanitizeFilenamePart(resolved.postInfo.title) ||
    `download_${Date.now()}`;

  return `Sora_${baseId}${asset.suffix}.${asset.extension}`;
};
