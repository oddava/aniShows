import { useEffect, useState } from 'react';

/**
 * The profile picture, or the site's one default: the name's initial on an
 * accent-soft circle (the same mark the navbar uses).
 */
export default function ProfileAvatar({ avatar, username, className = 'h-20 w-20 text-3xl' }) {
    const [failed, setFailed] = useState(false);
    useEffect(() => setFailed(false), [avatar]);
    const showImage = Boolean(avatar) && !failed;

    return (
        <div className={`shrink-0 overflow-hidden rounded-full bg-[var(--signature-soft)] ${className}`}>
            {showImage ? (
                <img
                    src={avatar}
                    alt={username}
                    draggable={false}
                    className="h-full w-full object-cover"
                    onError={() => setFailed(true)}
                />
            ) : (
                <span
                    aria-hidden="true"
                    className="flex h-full w-full items-center justify-center font-semibold uppercase text-[var(--signature)]"
                >
                    {username?.charAt(0) || '?'}
                </span>
            )}
        </div>
    );
}
