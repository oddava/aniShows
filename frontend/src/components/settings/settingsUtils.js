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

export const DEFAULT_PROFILE_PRIMARY_COLOR = '#8db1ff';
// Quick picks come from the palette tokens (signature + the status colours in
// index.css); any other colour is still one click away in the picker.
export const PROFILE_COLOR_PRESETS = [
    '#8db1ff', // --signature
    '#b8a5ff', // --status-completed
    '#86cc90', // --status-watching
    '#e9c46a', // --status-on-hold
    '#f391ba', // --status-dropped
    '#a3abb6', // --status-planning
];

export function normalizeProfilePrimaryColor(value) {
    const normalized = String(value || '').trim().toLowerCase();
    // The old defaults (pre-overhaul violet, retired lime) were never a
    // choice: show the signature.
    if (normalized === '#8b5cf6' || normalized === '#d4f65a') return DEFAULT_PROFILE_PRIMARY_COLOR;
    return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : DEFAULT_PROFILE_PRIMARY_COLOR;
}

export function isGifFile(file) {
    if (!file) return false;
    const mimeType = String(file.type || '').toLowerCase();
    if (mimeType === 'image/gif') return true;
    return /\.gif$/i.test(String(file.name || ''));
}

/**
 * Comparable form of a links list: trimmed `(platform, value || url)` pairs.
 * The API stores `{platform, url, normalized_url, ...}` while the form holds
 * `{platform, value}`, so compare this shape rather than the raw objects.
 */
export function toComparableSocialLinks(links = []) {
    return (links || [])
        .map((link) => ({
            platform: (link?.platform || '').trim(),
            value: (link?.value || link?.url || '').trim(),
        }))
        .filter((link) => link.platform || link.value);
}

/** True when the form's links differ from the stored ones. */
export function socialLinksChanged(formLinks, storedLinks) {
    return (
        JSON.stringify(toComparableSocialLinks(formLinks)) !==
        JSON.stringify(toComparableSocialLinks(storedLinks))
    );
}
