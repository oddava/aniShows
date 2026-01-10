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

    // If it's already a full URL (external), return it
    if (cleanUrl.startsWith('http')) return cleanUrl;

    // Ensure it starts with / for local appending
    if (!cleanUrl.startsWith('/')) cleanUrl = `/${cleanUrl}`;

    // Prepend API URL
    return `${import.meta.env.VITE_API_URL || ''}${cleanUrl}`;
};
