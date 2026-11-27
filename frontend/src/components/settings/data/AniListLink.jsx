import { useEffect, useId, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { formatDistanceToNowStrict } from 'date-fns';

import { importExportApi } from '../../../api/client';
import { getApiErrorMessage } from '../../../api/errors';
import { anilistLinkKeys } from '../../../api/queries/importJobs';
import { formatDateTimeInUserTimezone } from '../../../utils/dateUtils';
import SettingsSwitch from '../SettingsSwitch';
import { SOURCES } from './importHelpers';

const AVATAR_QUERY = 'query ($name: String) { User(name: $name) { avatar { medium } } }';

/** A public AniList account's picture URL (https only), or null. */
export async function fetchAniListAvatar(username) {
    const response = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: AVATAR_QUERY, variables: { name: username } }),
    });
    if (!response.ok) return null;
    const url = (await response.json())?.data?.User?.avatar?.medium;
    return typeof url === 'string' && url.startsWith('https://') ? url : null;
}

/** Re-render once `isoTime` has passed (the sync cooldown ending). */
function useNowUntil(isoTime) {
    const [now, setNow] = useState(() => Date.now());
    useEffect(() => {
        const until = isoTime ? new Date(isoTime).getTime() : 0;
        const wait = until - Date.now();
        if (!(wait > 0)) return undefined;
        const timer = setTimeout(() => setNow(Date.now()), Math.min(wait + 500, 2 ** 31 - 1));
        return () => clearTimeout(timer);
    }, [isoTime]);
    return now;
}

const timeOfDay = (iso) => formatDateTimeInUserTimezone(iso, { hour: 'numeric', minute: '2-digit' });

const syncedAgo = (iso) => {
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime())) return 'Not synced yet';
    return `Synced ${formatDistanceToNowStrict(date, { addSuffix: true })}`;
};

/** A linked AniList account: pull-only. Sync now, daily sync on or off, unlink. */
export default function AniListLink({ user, link, running, disabled, onStarted, onError }) {
    const queryClient = useQueryClient();
    const ids = useId();
    const now = useNowUntil(link.sync_available_at);
    const refreshLink = () => queryClient.invalidateQueries({ queryKey: anilistLinkKeys.forUser(user.id) });

    const syncMutation = useMutation({
        mutationFn: () => importExportApi.syncAniList(),
        onSuccess: () => {
            refreshLink();
            onStarted();
        },
        onError: (err) => {
            refreshLink();
            onError(getApiErrorMessage(err, 'The sync could not start.'));
        },
    });
    const dailyMutation = useMutation({
        mutationFn: (autoSync) => importExportApi.saveAniListLink({ username: link.username, autoSync }),
        onSuccess: refreshLink,
        onError: (err) => onError(getApiErrorMessage(err, 'The setting could not be saved.')),
    });
    const unlinkMutation = useMutation({
        mutationFn: () => importExportApi.unlinkAniList(),
        onSuccess: refreshLink,
        onError: (err) => onError(getApiErrorMessage(err, 'AniList could not be unlinked.')),
    });

    // The account's own AniList picture: stored by the last sync, else read
    // from AniList's public API once (a link made before pictures were kept).
    const avatarQuery = useQuery({
        queryKey: ['anilistAvatar', link.username],
        queryFn: () => fetchAniListAvatar(link.username),
        enabled: !link.avatar_url && Boolean(link.username),
        staleTime: Infinity,
        retry: false,
    });
    const avatar = link.avatar_url || avatarQuery.data || null;

    const busy = syncMutation.isPending || dailyMutation.isPending || unlinkMutation.isPending;
    const coolingDown = link.sync_available_at && new Date(link.sync_available_at).getTime() > now;
    const daily = dailyMutation.isPending ? dailyMutation.variables : !!link.auto_sync && !link.auto_sync_paused;

    return (
        <div className="rounded-xl bg-white/[0.03] p-4">
            <div className="flex flex-wrap items-center gap-3">
                {avatar ? (
                    <img
                        src={avatar}
                        alt=""
                        draggable={false}
                        className="h-10 w-10 shrink-0 rounded-full bg-[var(--ink-3)] object-cover"
                    />
                ) : (
                    <span
                        aria-hidden="true"
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-[var(--ink-3)] text-base font-semibold uppercase text-[var(--text-2)]"
                    >
                        {link.username?.charAt(0)}
                    </span>
                )}
                <div className="min-w-0 flex-1">
                    <p className="truncate text-[15px] text-[var(--text-1)]">
                        <span className="font-medium">{link.username}</span>
                        <a
                            href={SOURCES.anilist.profileUrl(link.username)}
                            target="_blank"
                            rel="noreferrer"
                            className="ml-2 text-sm text-[var(--text-3)] hover:text-[var(--text-1)]"
                        >
                            on AniList
                        </a>
                    </p>
                    <p className="text-sm text-[var(--text-2)]">
                        {syncedAgo(link.last_synced_at)}
                        {daily && <span className="text-[var(--text-3)]"> · syncs daily</span>}
                    </p>
                </div>
                <div className="flex items-center gap-1">
                    <button
                        type="button"
                        onClick={() => syncMutation.mutate()}
                        disabled={disabled || busy || running || coolingDown}
                        className="btn-secondary text-sm"
                    >
                        {syncMutation.isPending ? 'Starting...' : 'Sync now'}
                    </button>
                    <button
                        type="button"
                        onClick={() => unlinkMutation.mutate()}
                        disabled={disabled || busy}
                        className="btn-ghost text-sm"
                    >
                        {unlinkMutation.isPending ? 'Unlinking...' : 'Unlink'}
                    </button>
                </div>
            </div>
            {link.last_error && <p className="mt-3 text-sm text-[var(--danger)]">{link.last_error}</p>}
            {coolingDown && !running && (
                <p className="mt-3 text-sm text-[var(--text-3)]">
                    Sync now is available again at {timeOfDay(link.sync_available_at)}.
                </p>
            )}

            <div className="mt-4 flex items-center justify-between gap-4 border-t border-white/[0.06] pt-4">
                <div>
                    <p id={`${ids}-daily`} className="text-[15px] text-[var(--text-1)]">Keep in sync</p>
                    <p id={`${ids}-daily-help`} className="text-sm text-[var(--text-2)]">
                        {link.auto_sync_paused
                            ? 'Paused after 5 failed syncs in a row. Turn it on to try again.'
                            : 'Pull changes from AniList once a day. Unlinking keeps your list.'}
                    </p>
                </div>
                <SettingsSwitch
                    checked={daily}
                    onClick={() => dailyMutation.mutate(!daily)}
                    disabled={disabled || busy}
                    labelledBy={`${ids}-daily`}
                    describedBy={`${ids}-daily-help`}
                />
            </div>
        </div>
    );
}
