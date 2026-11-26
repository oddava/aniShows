import { useEffect, useState } from 'react';
import { cachedCoverAccent, coverAccent } from '../../utils/coverAccent';
import { getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';

/**
 * The header of a show with no banner (many have none, on AniList too): a
 * soft wash in the cover's own colour instead of an empty band or a
 * stretched, pixelated cover. Fades in once the colour is known.
 */
export default function HeroTint({ anime }) {
    const key = getOptimizedImageUrl(anime, 'cover', 'medium');
    const [tint, setTint] = useState(() => ({ key, color: cachedCoverAccent(key) || null }));
    const color = tint.key === key ? tint.color : null;

    useEffect(() => {
        if (!key) return undefined;
        let cancelled = false;
        coverAccent(null, key, [
            getOptimizedImageUrl(anime, 'cover', 'small'),
            key,
            getImageFallbackUrl(anime, 'cover'),
        ]).then((found) => {
            if (!cancelled) setTint({ key, color: found });
        });
        return () => { cancelled = true; };
    }, [anime, key]);

    return (
        <div
            aria-hidden="true"
            data-hero-tint={color || undefined}
            className="absolute inset-0 transition-opacity duration-700 ease-out"
            style={{
                opacity: color ? 1 : 0,
                background: color
                    ? `radial-gradient(90% 160% at 72% 0%, color-mix(in srgb, ${color} 34%, transparent), transparent 72%),
                       radial-gradient(60% 120% at 10% 0%, color-mix(in srgb, ${color} 16%, transparent), transparent 70%)`
                    : undefined,
            }}
        />
    );
}
