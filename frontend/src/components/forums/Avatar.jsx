import React, { useState } from 'react';

/**
 * A forum author's picture. Falls back to their initials on a slate circle
 * when there is no picture or it fails to load (never a broken image).
 */
const Avatar = ({ user, size = 'md' }) => {
    const [failedSrc, setFailedSrc] = useState(null);
    const dims = size === 'xs' ? 'w-6 h-6 text-[10px]' : size === 'sm' ? 'w-8 h-8 text-xs' : 'w-10 h-10 text-sm';
    if (user?.avatar && failedSrc !== user.avatar) {
        return (
            <img
                src={user.avatar}
                alt=""
                className={`${dims} shrink-0 rounded-full bg-[var(--ink-3)] object-cover`}
                loading="lazy"
                onError={() => setFailedSrc(user.avatar)}
            />
        );
    }
    return (
        <div
            aria-hidden="true"
            className={`${dims} shrink-0 rounded-full bg-[var(--ink-3)] flex items-center justify-center font-semibold text-[var(--text-2)]`}
        >
            {user?.username?.substring(0, 2).toUpperCase()}
        </div>
    );
};

export default Avatar;
