import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ArrowUpRight, X } from 'lucide-react';

import api from '../api/httpClient';

export const DISMISSED_KEY = 'anishows:dismissed-announcements';
const MAX_REMEMBERED = 50;

/** Soft tints per level, from the site palette (one accent; status colours for the rest). */
export const ANNOUNCEMENT_LEVELS = {
    info: { label: 'Info', bg: 'var(--signature-soft)', dot: 'var(--signature)' },
    success: { label: 'Good news', bg: 'rgb(134 204 144 / 0.12)', dot: 'var(--success)' },
    warning: { label: 'Heads up', bg: 'rgb(233 196 106 / 0.12)', dot: 'var(--status-on-hold)' },
    critical: { label: 'Important', bg: 'rgb(242 135 143 / 0.13)', dot: 'var(--danger)' },
};

function readDismissed() {
    try {
        const raw = window.localStorage.getItem(DISMISSED_KEY);
        const parsed = raw ? JSON.parse(raw) : [];
        return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
        return [];
    }
}

function writeDismissed(ids) {
    try {
        window.localStorage.setItem(DISMISSED_KEY, JSON.stringify(ids.slice(-MAX_REMEMBERED)));
    } catch {
        // Storage blocked (private mode): the banner just comes back next visit.
    }
}

const isSafeLink = (url) => typeof url === 'string' && /^(https?:\/\/|\/(?!\/))/i.test(url.trim());

/**
 * One announcement as a bar: a level dot, the title and body, an optional
 * link and a dismiss button. Presentational, so the admin can preview it.
 */
export function AnnouncementBar({ announcement, onDismiss, className = '' }) {
    const level = ANNOUNCEMENT_LEVELS[announcement.level] || ANNOUNCEMENT_LEVELS.info;
    const link = isSafeLink(announcement.link_url) ? announcement.link_url.trim() : null;
    const external = link && /^https?:\/\//i.test(link) && !link.startsWith(window.location.origin);
    return (
        <div
            role="region"
            aria-label={`${level.label}: ${announcement.title}`}
            className={`rounded-[var(--radius-md)] ${className}`}
            style={{ background: level.bg }}
        >
            <div className="flex items-start gap-3 py-2 pl-4 pr-1.5 sm:items-center">
                <span aria-hidden="true" className="mt-[0.4375rem] h-2 w-2 shrink-0 rounded-full sm:mt-0" style={{ background: level.dot }} />
                <p className="min-w-0 flex-1 py-1.5 text-sm leading-snug text-[var(--text-1)]">
                    <span className="font-semibold">{announcement.title || 'Announcement title'}</span>
                    {announcement.body && <span className="text-[var(--text-2)]"> {announcement.body}</span>}
                    {link && (
                        <a
                            href={link}
                            {...(external ? { target: '_blank', rel: 'noopener noreferrer' } : {})}
                            className="ml-1.5 inline-flex items-center gap-0.5 whitespace-nowrap font-semibold text-[var(--signature)] hover:text-[var(--signature-hover)]"
                        >
                            {announcement.link_label || 'Learn more'}
                            {external && <ArrowUpRight className="h-3.5 w-3.5" aria-hidden="true" />}
                        </a>
                    )}
                </p>
                {onDismiss && (
                    <button
                        type="button"
                        onClick={onDismiss}
                        aria-label="Dismiss announcement"
                        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-lg text-[var(--text-2)] transition-colors hover:bg-white/[0.06] hover:text-[var(--text-1)] sm:-my-1"
                    >
                        <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                )}
            </div>
        </div>
    );
}

/**
 * Site-wide announcements set in the admin. Shows the live ones the visitor
 * has not dismissed; dismissals are remembered on this device. Any failure
 * shows nothing: the banner is never in the way of the page.
 */
const REFRESH_MS = 5 * 60_000;

const endsAtMs = (item) => {
    const time = item?.ends_at ? Date.parse(item.ends_at) : NaN;
    return Number.isNaN(time) ? null : time;
};

/** "Now", advanced exactly when the next banner's end time passes. */
function useNowUntilNextEnd(items) {
    const [now, setNow] = useState(() => Date.now());
    const nextEnd = items.map(endsAtMs).filter((time) => time !== null && time > now).sort((a, b) => a - b)[0];
    useEffect(() => {
        if (!nextEnd) return undefined;
        // setTimeout caps at ~24.8 days; a later end just re-arms on the next render.
        const timer = window.setTimeout(() => setNow(Date.now()), Math.min(nextEnd - Date.now() + 50, 2 ** 31 - 1));
        return () => window.clearTimeout(timer);
    }, [nextEnd]);
    return now;
}

export default function AnnouncementBanner({ className = '' }) {
    const [dismissed, setDismissed] = useState(readDismissed);
    // Refreshed every few minutes while the tab is visible and on return to it,
    // so a scheduled banner appears (and an ended one goes) without a reload.
    const { data } = useQuery({
        queryKey: ['announcements', 'active'],
        queryFn: ({ signal }) => api.get('/announcements/active/', { signal }).then((response) => response.data),
        staleTime: REFRESH_MS,
        refetchInterval: REFRESH_MS,
        refetchIntervalInBackground: false,
        refetchOnWindowFocus: true,
        retry: false,
        meta: { silent: true },
    });

    const live = (Array.isArray(data) ? data : data?.results || [])
        .filter((item) => item && item.id !== undefined && !dismissed.includes(String(item.id)));
    const now = useNowUntilNextEnd(live);
    const items = live.filter((item) => {
        const end = endsAtMs(item);
        return end === null || end > now;
    });

    if (items.length === 0) return null;

    const dismiss = (id) => {
        const next = [...dismissed, String(id)];
        setDismissed(next);
        writeDismissed(next);
    };

    return (
        <div className={`page-container space-y-2 pt-3 ${className}`}>
            {items.map((item) => (
                <AnnouncementBar key={item.id} announcement={item} onDismiss={() => dismiss(item.id)} />
            ))}
        </div>
    );
}
