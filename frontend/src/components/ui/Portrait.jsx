import { memo, useEffect, useState } from 'react';
import { User } from 'lucide-react';

/**
 * A character / staff / person picture in a fixed slot (D1). The slot keeps
 * its size whether or not the image arrives: a neutral silhouette shows while
 * it loads and stays if it fails, and the image fades in once decoded. No
 * empty boxes, no half-loaded strips, no layout shift.
 *
 * `src` may be empty; `srcSet`/`sizes` are optional.
 */
function Portrait({ src, srcSet, sizes = '64px', alt = '', className = '', imgClassName = 'object-cover', loading = 'lazy' }) {
    const [state, setState] = useState(src ? 'loading' : 'missing');

    useEffect(() => {
        setState(src ? 'loading' : 'missing');
    }, [src]);

    return (
        <span className={`relative block overflow-hidden bg-[var(--ink-3)] ${className}`}>
            {state !== 'loaded' && (
                <span
                    {...(state === 'missing' && alt ? { role: 'img', 'aria-label': alt } : { 'aria-hidden': true })}
                    className="absolute inset-0 flex items-center justify-center text-gray-600"
                >
                    <User aria-hidden="true" className="h-1/2 max-h-10 w-1/2 max-w-10" strokeWidth={1.5} />
                </span>
            )}
            {state !== 'missing' && (
                <img
                    src={src}
                    srcSet={srcSet}
                    sizes={sizes}
                    alt={alt}
                    loading={loading}
                    decoding="async"
                    onLoad={() => setState('loaded')}
                    onError={() => setState('missing')}
                    data-loaded={state === 'loaded'}
                    className={`img-fade absolute inset-0 h-full w-full ${imgClassName}`}
                />
            )}
        </span>
    );
}

export default memo(Portrait);
