import { normalizeUrl } from '../SmartLinkInput';

export function getResponsiveBannerAspect(width) {
    const safeWidth = Math.max(320, Number(width) || 320);

    // Keep this in sync with ProfileHeader + Settings banner preview classes.
    if (safeWidth >= 1536) return 5.8;
    if (safeWidth >= 1280) return 5.2;
    if (safeWidth >= 1024) return 4.9;
    if (safeWidth >= 768) return 4.6;
    if (safeWidth >= 640) return 3.8;
    return 3.2;
}

export function decodeHtmlEntities(text = '') {
    if (!text || typeof text !== 'string') return '';
    return text
        .replace(/&lt;/gi, '<')
        .replace(/&gt;/gi, '>')
        .replace(/&quot;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&amp;/gi, '&');
}

export function canonicalizeSocialUrl(url = '') {
    const trimmed = String(url).trim();
    if (!trimmed) return '';

    const normalizedProtocol = trimmed.replace(/^http:\/\//i, 'https://');

    try {
        const parsed = new URL(normalizedProtocol);
        const host = parsed.hostname.toLowerCase().replace(/^www\./, '');
        const path = parsed.pathname.replace(/\/+$/, '');
        const search = parsed.search || '';
        return `https://${host}${path}${search}`;
    } catch {
        return normalizedProtocol.toLowerCase().replace(/\/+$/, '');
    }
}

export function getSocialLinkDuplicateKey(link = {}) {
    const platform = link.platform?.trim().toLowerCase() || '';
    const value = link.value?.trim() || '';
    if (!value) return '';

    const normalized = normalizeUrl(platform, value).trim();
    const lowered = normalized.toLowerCase();

    if (lowered.startsWith('http://') || lowered.startsWith('https://')) {
        return `url:${canonicalizeSocialUrl(lowered)}`;
    }

    return `platform:${platform}|value:${value.toLowerCase()}`;
}

export const DEFAULT_PROFILE_PRIMARY_COLOR = '#75698d';
export const PROFILE_COLOR_PRESETS = [
    '#75698d',
    '#ef4444',
    '#f97316',
    '#eab308',
    '#22c55e',
    '#06b6d4',
    '#3b82f6',
    '#ec4899',
];

export function normalizeProfilePrimaryColor(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_PROFILE_PRIMARY_COLOR;
}

export function isGifFile(file) {
    if (!file) return false;
    const mimeType = String(file.type || '').toLowerCase();
    if (mimeType === 'image/gif') return true;
    return /\.gif$/i.test(String(file.name || ''));
}

export const DEFAULT_NOTIFICATION_PREFERENCES = {
    email_new_episodes: true,
    push_new_episodes: true,
    push_review_replies: true,
    push_new_follower: true,
};
