/**
 * Helper to get the full image URL.
 * Handles placeholder generation if URL is missing.
 * Cleans up localhost/docker internal URLs.
 * 
 * @param {string} url - The image URL path (absolute or relative)
 * @param {string} title - The title of the anime (for placeholder text)
 * @returns {string} The processed, ready-to-use image URL
 */
export const getImageUrl = (url, title = 'Anime') => {
    if (!url) {
        return `https://placehold.co/300x450/1a1a1a/8b5cf6?text=${encodeURIComponent(title)}`;
    }

    let cleanUrl = url;

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
    const imageUrl = images[size] || images.original;
    
    return getImageUrl(imageUrl, anime.title);
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
        if (url) {
            urls.push(`${getImageUrl(url)} ${width}w`);
        }
    });

    return urls.join(', ');
};
