import { Link2 } from 'lucide-react';
import { notify, notifyError } from '../ui/toast';

const SITE_ORIGIN = 'https://anishows.com';

/** The profile's canonical, shareable URL: /u/<name>, which unfurls as its own card. */
export function profileShareUrl(username, origin = typeof window !== 'undefined' ? window.location.origin : SITE_ORIGIN) {
    return `${origin}/u/${encodeURIComponent(username)}`;
}

/**
 * "Share": copies the profile link and says so ("Link copied"). Shared links
 * show this profile's own card (title, bio, banner), served with the page
 * (apps/users/share_preview.py).
 */
export default function ShareProfileButton({ username, className = '' }) {
    if (!username) return null;

    const handleShare = async () => {
        const url = profileShareUrl(username);
        try {
            await navigator.clipboard.writeText(url);
            notify('Link copied', { id: 'profile-share' });
        } catch {
            notifyError(`Couldn’t copy the link. It is ${url}`, { id: 'profile-share' });
        }
    };

    return (
        <button
            type="button"
            onClick={handleShare}
            aria-label={`Share: copy the link to ${username}'s profile`}
            className={`btn-secondary inline-flex min-h-[2.75rem] items-center gap-2 px-4 text-[15px] ${className}`}
        >
            <Link2 aria-hidden="true" className="h-4 w-4" />
            Share
        </button>
    );
}
