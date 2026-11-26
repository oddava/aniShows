import { normalizeUrl } from '../SmartLinkInput';

/**
 * Banners are kept at 3:1 (1500x500 is the usual size, as on X and
 * Discord), so a banner made at that size is stored whole. The profile shows
 * a centred band of it (wider than 3:1 on desktop), as AniList does.
 */
export const BANNER_ASPECT = 3;

/** A picture this close to 3:1 needs no crop: it is used as it is. */
export const BANNER_ASPECT_TOLERANCE = 0.08;

export function fitsBannerAspect(width, height) {
    if (!width || !height) return false;
    return Math.abs(width / height / BANNER_ASPECT - 1) <= BANNER_ASPECT_TOLERANCE;
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
