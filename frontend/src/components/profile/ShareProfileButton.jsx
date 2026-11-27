import { useState } from 'react';
import { Check, Link2 } from 'lucide-react';
import { notify, notifyError } from '../ui/toast';

const SITE_ORIGIN = 'https://anishows.com';

/** The profile's canonical, shareable URL: /u/<name>, which unfurls as its own card. */
export function profileShareUrl(username, origin = typeof window !== 'undefined' ? window.location.origin : SITE_ORIGIN) {
    return `${origin}/u/${encodeURIComponent(username)}`;
}

/**
 * Share a profile: the system share sheet on touch screens, else copy the
 * link and say so with a "Link copied" toast. Shared links show this
 * profile's own card (apps/users/share_preview.py).
 */
export default function ShareProfileButton({ username }) {
    const [copied, setCopied] = useState(false);
    if (!username) return null;

    const share = async () => {
        const url = profileShareUrl(username);
        if (navigator.share && window.matchMedia?.('(pointer: coarse)').matches) {
            try {
                await navigator.share({ title: `${username} on AniShows`, url });
            } catch {
                // The share sheet was dismissed: nothing to report.
            }
            return;
        }
        try {
            await navigator.clipboard.writeText(url);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 1800);
            notify('Link copied', { id: 'profile-share' });
        } catch {
            notifyError(`Couldn’t copy the link. It is ${url}`, { id: 'profile-share' });
        }
    };

    return (
        <button
            type="button"
            onClick={share}
            className="profile-icon-btn"
            aria-label="Share profile"
            title={copied ? 'Link copied' : 'Share profile'}
        >
            {copied
                ? <Check aria-hidden="true" className="h-[18px] w-[18px]" />
                : <Link2 aria-hidden="true" className="h-[18px] w-[18px]" />}
        </button>
    );
}
