import { memo, useState } from 'react';
import { getImageUrl } from '../../utils/imageUtils';

const isUsable = (value) => typeof value === 'string' && value.trim() && !/^(null|undefined)$/i.test(value.trim());

/**
 * The cover URLs to try for an anime thumbnail, best first: the optimised
 * size, then the original, then the external copy. Blank fields are skipped;
 * no inline placeholder is added (CoverThumb shows its own quiet slot).
 */
export function animeCoverSources(anime, size = 'small') {
    if (!anime) return [];
    const preferred = {
        small: [anime.cover_image_small, anime.cover_image_medium],
        medium: [anime.cover_image_medium, anime.cover_image_large],
        large: [anime.cover_image_large],
    }[size] || [];
    return [...preferred, anime.cover_image, anime.cover_image_external_url]
        .filter(isUsable)
        .map((url) => getImageUrl(url));
}

/**
 * A small cover in a fixed slot. It tries each source in turn and fades the
 * first one that loads in; while loading, and when every source fails, the
 * slot stays a quiet slate block. The <img> is invisible until it has loaded,
 * so a broken-image icon or the alt text never shows.
 */
function CoverThumb({ sources, alt = '', className = '', loading = 'lazy' }) {
    const list = [...new Set((sources || []).filter(isUsable))];
    const key = list.join('|');
    const [state, setState] = useState({ key, attempt: 0, loaded: false });

    // New sources (another row reusing this slot): start over.
    if (state.key !== key) setState({ key, attempt: 0, loaded: false });

    const src = state.key === key ? list[state.attempt] : list[0];

    return (
        <span className={`relative block overflow-hidden bg-[var(--ink-3)] ${className}`}>
            {src && (
                <img
                    key={src}
                    src={src}
                    alt={alt}
                    loading={loading}
                    decoding="async"
                    onLoad={() => setState((current) => ({ ...current, loaded: true }))}
                    onError={() => setState((current) => ({ ...current, attempt: current.attempt + 1, loaded: false }))}
                    data-loaded={state.loaded}
                    className="img-fade absolute inset-0 h-full w-full object-cover"
                />
            )}
        </span>
    );
}

export default memo(CoverThumb);
