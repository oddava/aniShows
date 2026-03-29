import React, { useState, useCallback, memo } from 'react';
import { getOptimizedImageUrl as getCanonicalOptimizedImageUrl } from '../utils/imageUtils';

/**
 * OptimizedImage Component
 * 
 * A production-ready image component with:
 * - Responsive srcset for different screen sizes
 * - Lazy loading with intersection observer
 * - WebP format with JPEG fallback
 * - Loading state with skeleton
 * - Error handling with fallback
 * - Blur-up loading effect
 * 
 * @param {Object} props
 * @param {string} props.src - The default image source
 * @param {string} props.srcSmall - Small version of image (150px width)
 * @param {string} props.srcMedium - Medium version of image (230px width)
 * @param {string} props.srcLarge - Large version of image (300px width)
 * @param {string} props.alt - Alt text for accessibility
 * @param {string} props.className - Additional CSS classes
 * @param {string} props.loading - 'lazy' or 'eager'
 * @param {Function} props.onLoad - Callback when image loads
 * @param {Function} props.onError - Callback when image fails
 * @param {string} props.fallback - Fallback image URL on error
 * @param {string} props.aspectRatio - Aspect ratio for container (e.g., '2/3')
 * @param {boolean} props.blurUp - Enable blur-up loading effect
 */
const OptimizedImage = memo(function OptimizedImage({
  src,
  srcSmall,
  srcMedium,
  srcLarge,
  alt = '',
  className = '',
  loading = 'lazy',
  onLoad,
  onError,
  fallback = null,
  aspectRatio = null,
  blurUp = true,
  ...props
}) {
  const [isLoaded, setIsLoaded] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [currentSrc, setCurrentSrc] = useState(src);

  // Build srcset for responsive images
  const buildSrcSet = useCallback(() => {
    const sources = [];
    
    if (srcSmall) sources.push(`${srcSmall} 150w`);
    if (srcMedium) sources.push(`${srcMedium} 230w`);
    if (srcLarge) sources.push(`${srcLarge} 300w`);
    if (src) sources.push(`${src} 600w`);
    
    return sources.length > 0 ? sources.join(', ') : undefined;
  }, [src, srcSmall, srcMedium, srcLarge]);

  // Determine sizes attribute based on common use cases
  const getSizes = useCallback(() => {
    // Default sizes for anime cards
    return '(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 200px';
  }, []);

  const handleLoad = useCallback(() => {
    setIsLoaded(true);
    onLoad?.();
  }, [onLoad]);

  const handleError = useCallback(() => {
    setHasError(true);
    
    // Try fallback if available
    if (fallback && currentSrc !== fallback) {
      setCurrentSrc(fallback);
    } else {
      onError?.();
    }
  }, [fallback, currentSrc, onError]);

  const srcSet = buildSrcSet();
  const sizes = srcSet ? getSizes() : undefined;

  // Container styles for aspect ratio and loading state
  const containerStyle = {
    aspectRatio: aspectRatio,
    position: 'relative',
    overflow: 'hidden',
    backgroundColor: 'var(--color-dark-100)',
  };

  const imageStyle = {
    width: '100%',
    height: '100%',
    objectFit: 'cover',
    transition: blurUp ? 'opacity 0.3s ease-in-out, filter 0.3s ease-in-out' : undefined,
    opacity: isLoaded ? 1 : 0,
    filter: blurUp && !isLoaded ? 'blur(10px)' : 'none',
  };

  // Skeleton loader
  const skeletonStyle = {
    position: 'absolute',
    inset: 0,
    backgroundColor: 'var(--color-dark-300)',
    animation: 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
    opacity: isLoaded ? 0 : 1,
    transition: 'opacity 0.3s ease-in-out',
  };

  return (
    <div style={containerStyle} className={className}>
      {/* Skeleton loader */}
      <div style={skeletonStyle} />
      
      {/* Main image */}
      {!hasError || fallback ? (
        <img
          src={currentSrc}
          srcSet={srcSet}
          sizes={sizes}
          alt={alt}
          loading={loading}
          onLoad={handleLoad}
          onError={handleError}
          style={imageStyle}
          {...props}
        />
      ) : (
        // Error placeholder
        <div 
          style={{
            ...imageStyle,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: 'var(--color-dark-300)',
            color: '#666',
            fontSize: '0.875rem',
          }}
        >
          {alt.charAt(0).toUpperCase() || '?'}
        </div>
      )}
    </div>
  );
});

/**
 * Hook to determine optimal image size based on container width
 * @param {RefObject} containerRef - React ref to container element
 * @returns {string} - Optimal size key ('small', 'medium', 'large')
 */
// eslint-disable-next-line react-refresh/only-export-components
export function useOptimalImageSize(containerRef) {
  const [size, setSize] = React.useState('medium');

  React.useEffect(() => {
    if (!containerRef.current) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        const width = entry.contentRect.width;
        if (width <= 150) setSize('small');
        else if (width <= 230) setSize('medium');
        else setSize('large');
      }
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, [containerRef]);

  return size;
}

/**
 * Utility to get the best image URL based on available sizes
 * @param {Object} anime - Anime object with image URLs
 * @param {string} type - 'cover' or 'banner'
 * @param {string} preferredSize - 'small', 'medium', 'large', or 'original'
 * @returns {string} - Best available image URL
 */
// eslint-disable-next-line react-refresh/only-export-components
export function getOptimizedImageUrl(anime, type = 'cover', preferredSize = 'medium') {
  return getCanonicalOptimizedImageUrl(anime, type, preferredSize);
}

export default OptimizedImage;
