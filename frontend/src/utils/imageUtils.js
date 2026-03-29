/**
 * Helper to get the full image URL.
 * Handles placeholder generation if URL is missing.
 * Cleans up localhost/docker internal URLs.
 *
 * @param {string} url - The image URL path (absolute or relative)
 * @param {string} title - The title of the anime (for placeholder text)
 * @returns {string} The processed, ready-to-use image URL
 */

const isMediaPath = (url) =>
    typeof url === 'string' && url.includes('/media/');
const isBlankLike = (value) => {
    if (typeof value !== 'string') return true;
    const normalized = value.trim().toLowerCase();
    return !normalized || normalized === 'null' || normalized === 'undefined';
};
const coerceUrl = (value) => (isBlankLike(value) ? null : value.trim());

/**
 * Whether an image URL can be safely sampled with canvas APIs in-browser.
 * Canvas sampling should be limited to same-origin (plus blob/data) sources.
 */
export const isSameOriginImageUrl = (url) => {
    const normalizedUrl = coerceUrl(url);
    if (!normalizedUrl) return false;

    if (normalizedUrl.startsWith('/')) return true;
    if (normalizedUrl.startsWith('blob:')) return true;
    if (normalizedUrl.startsWith('data:image/')) return true;

    if (typeof window === 'undefined' || !window.location?.origin) {
        return false;
    }

    try {
        const parsed = new URL(normalizedUrl, window.location.origin);
        return parsed.origin === window.location.origin;
    } catch {
        return false;
    }
};

const appendCacheBuster = (url) => {
    if (!url) return url;
    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}cb=${Date.now()}`;
};

export const getImageUrl = (url, title = 'Anime') => {
    const normalizedUrl = coerceUrl(url);
    if (!normalizedUrl) {
        return `https://placehold.co/10131b/75698d?text=${encodeURIComponent(title)}`;
    }

    let cleanUrl = normalizedUrl;

    // Clean up internal docker networking URLs if they leak to frontend
    if (cleanUrl.includes('localhost:8000')) cleanUrl = cleanUrl.replace(/^https?:\/\/localhost:8000/, '');
    if (cleanUrl.includes('web:8000')) cleanUrl = cleanUrl.replace(/^https?:\/\/web:8000/, '');

    // Storage backends can return internal MinIO URLs in production.
    // Normalize those to app-relative /media paths so Caddy can proxy them.
    if (/^https?:\/\/(localhost|127\.0\.0\.1|minio|web)(:\d+)?\//.test(cleanUrl)) {
        cleanUrl = cleanUrl.replace(/^https?:\/\/[^/]+/, '');
    }

    // Convert path-style S3/MinIO URL (/bucket/media/...) into /media/...
    // so requests consistently route through app media proxy.
    if (/^\/[^/]+\/media\//.test(cleanUrl)) {
        cleanUrl = cleanUrl.replace(/^\/[^/]+\/media\//, '/media/');
    }

    // If it's already a full URL (external), return it
    if (cleanUrl.startsWith('http')) return cleanUrl;

    // Ensure it starts with / for local appending
    if (!cleanUrl.startsWith('/')) cleanUrl = `/${cleanUrl}`;

    // Prepend API URL
    return `${import.meta.env.VITE_API_URL || ''}${cleanUrl}`;
};

/**
 * Get optimized image URL for anime with multiple sizes
 * @param {Object} anime - Anime object with image URLs
 * @param {string} type - 'cover' or 'banner'
 * @param {string} size - 'small' | 'medium' | 'large' | 'original'
 * @returns {string} Optimized image URL
 */
export const getOptimizedImageUrl = (anime, type = 'cover', size = 'medium') => {
    if (!anime) return null;

    const sizeMap = {
        cover: {
            small: anime.cover_image_small,
            medium: anime.cover_image_medium,
            large: anime.cover_image_large,
            original: anime.cover_image,
        },
        banner: {
            small: anime.banner_image_small,
            medium: anime.banner_image_medium,
            large: anime.banner_image_large,
            original: anime.banner_image,
        },
    };

    const images = sizeMap[type] || sizeMap.cover;
    const imageUrl =
        images[size] ||
        images.original ||
        (type === 'banner' ? anime.banner_image_external_url : anime.cover_image_external_url);

    return getImageUrl(imageUrl, anime.title);
};

/**
 * Get a resilient fallback image URL (non-thumbnail preferred).
 * @param {Object} anime - Anime object with image URLs
 * @param {string} type - 'cover' or 'banner'
 * @returns {string} Fallback image URL
 */
export const getImageFallbackUrl = (anime, type = 'cover') => {
    if (!anime) return getImageUrl(null);

    if (type === 'banner') {
        const bannerFallback =
            anime.banner_image_external_url ||
            anime.cover_image_external_url ||
            anime.banner_image ||
            anime.cover_image;
        return getImageUrl(bannerFallback, anime.title);
    }

    const coverFallback =
        anime.cover_image_external_url ||
        anime.banner_image_external_url ||
        anime.cover_image ||
        anime.banner_image;
    return getImageUrl(coverFallback, anime.title);
};

/**
 * One-shot image fallback handler for <img onError>.
 * Clears srcSet/sizes before applying fallback to avoid repeated failing candidates.
 * @param {React.SyntheticEvent<HTMLImageElement>} event
 * @param {string} fallbackUrl
 */
export const applyImageFallback = (event, fallbackUrl) => {
    const img = event?.currentTarget;
    if (!img) return;

    const currentSource = img.currentSrc || img.src || '';
    const resolvedFallback = getImageUrl(fallbackUrl);
    const placeholderFallback = getImageUrl(null);

    if (img.dataset.fallbackApplied === '1') {
        return;
    }

    // First retry: bust CDN cache for local media URLs that might have a stale cached 403.
    if (isMediaPath(currentSource) && img.dataset.cacheBusted !== '1') {
        img.dataset.cacheBusted = '1';
        img.removeAttribute('srcset');
        img.removeAttribute('sizes');
        img.src = appendCacheBuster(currentSource);
        return;
    }

    img.dataset.fallbackApplied = '1';
    img.removeAttribute('srcset');
    img.removeAttribute('sizes');
    img.src = currentSource !== resolvedFallback ? resolvedFallback : placeholderFallback;
};

/**
 * Get srcset string for responsive images
 * @param {Object} anime - Anime object with image URLs
 * @param {string} type - 'cover' or 'banner'
 * @returns {string} srcset attribute value
 */
export const getImageSrcSet = (anime, type = 'cover') => {
    if (!anime) return '';

    const urls = [];
    const sizeMap = {
        cover: {
            small: { url: anime.cover_image_small, width: 150 },
            medium: { url: anime.cover_image_medium, width: 230 },
            large: { url: anime.cover_image_large, width: 300 },
        },
        banner: {
            small: { url: anime.banner_image_small, width: 400 },
            medium: { url: anime.banner_image_medium, width: 800 },
            large: { url: anime.banner_image_large, width: 1200 },
        },
    };

    const images = sizeMap[type] || sizeMap.cover;

    Object.values(images).forEach(({ url, width }) => {
        const normalized = coerceUrl(url);
        if (normalized) {
            urls.push(`${getImageUrl(url)} ${width}w`);
        }
    });

    return urls.join(', ');
};
