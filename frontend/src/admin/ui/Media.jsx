import { useState } from 'react';
import { Link } from 'react-router-dom';

import CoverThumb from '../../components/ui/CoverThumb';
import { getImageUrl } from '../../utils/imageUtils';

const AVATAR_SIZES = {
    xs: 'h-6 w-6 text-[0.625rem]',
    sm: 'h-8 w-8 text-xs',
    md: 'h-10 w-10 text-sm',
    lg: 'h-16 w-16 text-xl',
    xl: 'h-20 w-20 text-2xl',
};

/** A round avatar; the initial on slate while there is no image (or it fails). */
export function Avatar({ src, name = '', size = 'sm', className = '' }) {
    const [failedSrc, setFailedSrc] = useState(null);
    const failed = Boolean(src) && failedSrc === src;
    const dimension = AVATAR_SIZES[size] || AVATAR_SIZES.sm;
    const initial = (name || '?').trim().charAt(0).toUpperCase() || '?';
    return (
        <span className={`relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full bg-[var(--ink-3)] font-semibold text-[var(--text-2)] ${dimension} ${className}`}>
            {src && !failed ? (
                <img
                    src={getImageUrl(src)}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    onError={() => setFailedSrc(src)}
                    className="h-full w-full object-cover"
                />
            ) : (
                <span aria-hidden="true">{initial}</span>
            )}
        </span>
    );
}

/** A small 2:3 poster. `sources` is tried in order (CoverThumb). */
export function Poster({ src, sources, alt = '', size = 'sm', className = '' }) {
    const sizes = { xs: 'h-10 w-7', sm: 'h-14 w-10', md: 'h-24 w-16', lg: 'h-36 w-24', xl: 'h-48 w-32' };
    const list = sources || (src ? [getImageUrl(src)] : []);
    return (
        <CoverThumb
            sources={list}
            alt={alt}
            className={`shrink-0 rounded-[var(--radius-sm)] ${sizes[size] || sizes.sm} ${className}`}
        />
    );
}

/**
 * A user in a row: avatar, username (linking to their admin page) and an
 * optional second line.
 */
export function UserCell({ user, secondary, to, avatarSize = 'sm' }) {
    if (!user) return <span className="text-[var(--text-3)]">Deleted user</span>;
    const href = to === null ? null : to || (user.id ? `/admin/users/${user.id}` : null);
    const name = user.username || 'Unknown';
    return (
        <span className="flex min-w-0 items-center gap-3">
            <Avatar src={user.avatar} name={name} size={avatarSize} />
            <span className="min-w-0">
                {href ? (
                    <Link to={href} className="block truncate font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                        {name}
                    </Link>
                ) : (
                    <span className="block truncate font-medium text-[var(--text-1)]">{name}</span>
                )}
                {secondary && <span className="block truncate text-xs text-[var(--text-3)]">{secondary}</span>}
            </span>
        </span>
    );
}

/** An anime in a row: poster, title (linking to its admin page), a second line. */
export function AnimeCell({ anime, secondary, to, posterSize = 'xs' }) {
    if (!anime) return <span className="text-[var(--text-3)]">Deleted anime</span>;
    const href = to === null ? null : to || (anime.id ? `/admin/anime/${anime.id}` : null);
    // Every cover the row carries, best first: a missing local file falls
    // back to the AniList copy instead of an empty slot.
    const sources = [anime.poster_small, anime.poster, anime.cover_image, anime.cover_image_external_url]
        .filter((url) => typeof url === 'string' && url.trim())
        .map((url) => getImageUrl(url));
    return (
        <span className="flex min-w-0 items-center gap-3">
            <Poster sources={sources} size={posterSize} />
            <span className="min-w-0">
                {href ? (
                    <Link to={href} className="line-clamp-2 font-medium text-[var(--text-1)] hover:text-[var(--signature)]">
                        {anime.title}
                    </Link>
                ) : (
                    <span className="line-clamp-2 font-medium text-[var(--text-1)]">{anime.title}</span>
                )}
                {secondary && <span className="block truncate text-xs text-[var(--text-3)]">{secondary}</span>}
            </span>
        </span>
    );
}
