import { useMemo } from 'react';
import PropTypes from 'prop-types';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getImageSrcSet,
    getImageUrl,
    getOptimizedImageUrl,
} from '../../utils/imageUtils';

const DEFAULT_SIZES = {
    cover: '(max-width: 640px) 45vw, (max-width: 1024px) 30vw, 220px',
    banner: '(max-width: 640px) 100vw, (max-width: 1280px) 80vw, 1200px',
};

export default function AnimeMediaImage({
    anime,
    kind = 'cover',
    size = 'medium',
    alt,
    className = '',
    loading = 'lazy',
    decoding = 'async',
    responsive = false,
    sizes,
    onLoad,
    onError,
    ...rest
}) {
    const fallbackUrl = useMemo(() => getImageFallbackUrl(anime, kind), [anime, kind]);
    const src = useMemo(
        () => getOptimizedImageUrl(anime, kind, size) || fallbackUrl,
        [anime, fallbackUrl, kind, size]
    );
    const srcSet = useMemo(
        () => (responsive ? getImageSrcSet(anime, kind) : undefined),
        [anime, kind, responsive]
    );

    const resolvedAlt = alt || anime?.title || 'Anime';
    const resolvedSizes = responsive ? (sizes || DEFAULT_SIZES[kind] || DEFAULT_SIZES.cover) : undefined;

    const handleError = (event) => {
        applyImageFallback(event, fallbackUrl);
        onError?.(event);
    };

    return (
        <img
            src={src || getImageUrl(null, resolvedAlt)}
            srcSet={srcSet || undefined}
            sizes={srcSet ? resolvedSizes : undefined}
            alt={resolvedAlt}
            className={className}
            loading={loading}
            decoding={decoding}
            onLoad={onLoad}
            onError={handleError}
            {...rest}
        />
    );
}

AnimeMediaImage.propTypes = {
    anime: PropTypes.object,
    kind: PropTypes.oneOf(['cover', 'banner']),
    size: PropTypes.oneOf(['small', 'medium', 'large', 'original']),
    alt: PropTypes.string,
    className: PropTypes.string,
    loading: PropTypes.oneOf(['lazy', 'eager']),
    decoding: PropTypes.oneOf(['sync', 'async', 'auto']),
    responsive: PropTypes.bool,
    sizes: PropTypes.string,
    onLoad: PropTypes.func,
    onError: PropTypes.func,
};
