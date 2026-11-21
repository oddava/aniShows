import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import useListEntryMutation from '../../hooks/useListEntryMutation';
import { listQueries, userQueries } from '../../api/queries/lists';
import { scheduleQueries } from '../../api/queries/anime';
import { airedEpisodeCount, knownEpisodeTotal } from '../../utils/episodes';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import ProgressStepper from '../ui/ProgressStepper';
import ScorePicker from '../ui/ScorePicker';
import Skeleton from '../ui/Skeleton';
import { continueState, countdown, sortForContinue } from './continueModel';
import { airingPreview, clockTime, dayOffset, listedAirings, previewWhen, tonightFrom, useMinuteClock } from './airingModel';
import { formatDate } from '../../utils/dateUtils';

function stateText(state, now) {
    if (state.kind === 'ready') {
        if (state.behind === 1) return { text: `Episode ${state.nextEpisode} is out`, accent: true };
        if (state.behind > 12) return { text: `Catching up, episode ${state.nextEpisode} next`, accent: true };
        return { text: `${state.behind} new episodes`, accent: true };
    }
    if (state.kind === 'soon') return { text: `Episode ${state.nextEpisode} in ${countdown(state.nextAt, now)}` };
    if (state.kind === 'finished') return { text: `All ${state.total} watched. Score it?` };
    return { text: 'Up to date' };
}

/**
 * One show, set like a row on oddava.me: title and what's next on the left,
 * the episode stepper on the right. A finished show asks for a score and
 * completes in one tap.
 */
const ContinueRow = memo(function ContinueRow({ entry, now, onLive }) {
    const anime = entry.anime || {};
    const { entry: current, setProgress, save, isPending } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count, next_airing_episode: anime.next_airing_episode, next_airing_date: anime.next_airing_date },
        entry,
    });
    const href = `/anime/${anime.slug}`;
    // From what is on screen (a tap not yet written counts), so "episode 8 is
    // out" and the headline change the moment you +1.
    const [draft, setDraft] = useState(null);
    const watched = draft ?? current.episodes_watched;
    const state = continueState({ ...entry, episodes_watched: watched, score: current.score }, now);
    const line = stateText(state, now);
    useEffect(() => {
        onLive?.(entry.id, { kind: state.kind, delta: (watched || 0) - (entry.episodes_watched || 0) });
    }, [onLive, entry.id, entry.episodes_watched, state.kind, watched]);

    return (
        <li className="-mx-3 grid grid-cols-[3rem_minmax(0,1fr)] items-center gap-x-4 gap-y-2 rounded-[var(--radius-md)] px-3 py-3 transition-colors hover:bg-white/[0.03] sm:grid-cols-[3rem_minmax(0,1fr)_auto]">
            <Link to={href} tabIndex={-1} aria-hidden="true" className="row-span-2 self-start sm:row-span-1 sm:self-center">
                <img
                    src={getOptimizedImageUrl(anime, 'cover', 'small')}
                    onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                    alt=""
                    loading="lazy"
                    className="h-[72px] w-12 rounded-md bg-[var(--ink-2)] object-cover"
                />
            </Link>
            <div className="min-w-0 flex-1">
                <Link to={href} className="line-clamp-2 text-[17px] font-semibold leading-snug tracking-[-0.01em] text-[var(--text-1)] hover:text-[var(--signature)]">
                    {anime.title}
                </Link>
                <p className={`mt-0.5 text-[15px] tabular ${line.accent ? 'text-[var(--signature)]' : 'text-[var(--text-2)]'}`}>
                    {line.text}
                </p>
                {state.kind === 'finished' && (
                    <ScorePicker
                        className="mt-2 max-w-sm"
                        size="sm"
                        allowClear={false}
                        disabled={isPending}
                        value={current.score}
                        label={`Score ${anime.title}`}
                        onChange={(score) => save({ status: 'Completed', score })}
                    />
                )}
            </div>
            {state.kind !== 'finished' && (
                <ProgressStepper
                    size="sm"
                    className="col-start-2 justify-self-start sm:col-start-auto sm:justify-self-end"
                    value={current.episodes_watched || 0}
                    total={knownEpisodeTotal(anime)}
                    aired={airedEpisodeCount(anime, now)}
                    title={anime.title}
                    onCommit={(next) => setProgress(next)}
                    onDraft={setDraft}
                />
            )}
        </li>
    );
});

/**
 * The left column under the headline: today's episodes from your list, in
 * time order. One that already aired reads "15:04 · Episode 9 is out".
 */
function Tonight({ items, now, timezone }) {
    // Only episodes still to come today: what is already out is in Continue
    // and Your week, so each show is named once.
    const upcoming = items.today.filter((item) => !item.aired);
    if (!upcoming.length) {
        // Nothing left today: one line on what comes next, so the promise
        // ("know what's on") holds every day.
        const { next } = items;
        if (!next) return null;
        const offset = dayOffset(next.at, timezone, now);
        const day = offset === 1 ? 'Tomorrow' : formatDate(next.at, { weekday: 'short' }, timezone);
        return (
            <Link
                to={`/anime/${next.anime.slug}`}
                className="-mx-2 mt-8 block rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04] md:max-w-sm"
            >
                <span className="block text-sm text-[var(--text-3)]">Next up</span>
                <span className="line-clamp-2 text-[15px] text-[var(--text-1)]">{next.anime.title}</span>
                <span className="block text-sm text-[var(--signature)] tabular">
                    {day} {clockTime(next.at, timezone)}{next.episode ? ` · Episode ${next.episode}` : ''}
                </span>
            </Link>
        );
    }
    return (
        <div className="mt-10 md:max-w-sm">
            <h2 className="text-[15px] font-semibold text-[var(--text-2)]">Tonight</h2>
            <ul className="mt-2">
                {upcoming.map(({ anime, at, episode, aired }) => {
                    const ep = episode ? `Episode ${episode}` : 'New episode';
                    return (
                        <li key={anime.id}>
                            <Link
                                to={`/anime/${anime.slug}`}
                                className="-mx-2 block min-h-11 rounded-lg px-2 py-2 transition-colors hover:bg-white/[0.04]"
                            >
                                <span className="block truncate text-[15px] text-[var(--text-1)]">{anime.title}</span>
                                <span className={`block text-sm tabular ${aired ? 'text-[var(--signature)]' : 'text-[var(--text-3)]'}`}>
                                    {clockTime(at, timezone)} · {aired ? `${ep} is out` : `${ep} · in ${countdown(at, now)}`}
                                </span>
                            </Link>
                        </li>
                    );
                })}
            </ul>
        </div>
    );
}

/**
 * The top of the signed-in home (L2), laid out like oddava.me's front page:
 * who you are and one line about tonight on the left; your shows on the
 * right, ready ones first, with what's next and +1.
 */
export default function ContinueSection() {
    const now = useMinuteClock();
    const { user, isAuthenticated } = useAuth();
    const timezone = user?.preferred_timezone;
    const { data: watching, isPending } = useQuery({
        ...userQueries.watching(),
        staleTime: 60 * 1000,
    });
    const { data: summary } = useQuery({
        ...listQueries.summary(user?.username),
        enabled: Boolean(user?.username),
        staleTime: 60 * 1000,
    });
    // The same request as "Your week" below (shared cache), so Tonight and
    // the week never disagree about what airs today.
    const { data: scheduleDays } = useQuery({
        ...scheduleQueries.week(isAuthenticated, Boolean(user?.show_adult_content)),
        staleTime: 5 * 60 * 1000,
        enabled: isAuthenticated,
    });

    // The order is set once per visit: a row never jumps away under the
    // cursor after a +1 (new shows join at the end).
    const orderRef = useRef(null);
    const rows = useMemo(() => {
        const sorted = sortForContinue(watching, now);
        if (!orderRef.current) {
            if (sorted.length) orderRef.current = sorted.map((row) => row.entry.id);
            return sorted;
        }
        const position = new Map(orderRef.current.map((id, index) => [id, index]));
        const ordered = [...sorted].sort((a, b) => (position.get(a.entry.id) ?? Infinity) - (position.get(b.entry.id) ?? Infinity));
        orderRef.current = ordered.map((row) => row.entry.id);
        return ordered;
    }, [watching, now]);
    // Each row reports its live state, so the headline and the episode count
    // follow a +1 in the same frame as the row.
    const [live, setLive] = useState({});
    const onLive = useCallback((id, value) => {
        setLive((previous) => (
            previous[id]?.kind === value.kind && previous[id]?.delta === value.delta ? previous : { ...previous, [id]: value }
        ));
    }, []);
    const readyCount = rows.filter((row) => (live[row.entry.id]?.kind ?? row.state.kind) === 'ready').length;
    const episodeDelta = rows.reduce((sum, row) => sum + (live[row.entry.id]?.delta || 0), 0);
    const tonight = useMemo(() => {
        const airings = listedAirings(watching, scheduleDays);
        const result = tonightFrom(airings, now, timezone);
        // "Next up" is for a show Continue does not already list (its row
        // says when the next episode comes), so each show is named once.
        const inContinue = new Set((watching || []).map((entry) => entry.anime?.id));
        const next = airings.find((row) => row.at > now && row.at - now < 7 * 24 * 60 * 60 * 1000 && !inContinue.has(row.anime.id)) || null;
        return { ...result, next };
    }, [watching, scheduleDays, now, timezone]);
    // A fresh list: what airs soon, so the first screen still answers
    // "what's on" (as it does for visitors).
    const airingSoon = useMemo(
        () => (rows.length === 0 ? airingPreview(scheduleDays, timezone, now, 8).filter((row) => !row.aired).slice(0, 4) : []),
        [rows.length, scheduleDays, timezone, now],
    );
    const summaryLine = isPending
        ? ''
        : rows.length === 0
            ? 'Nothing in progress. Mark a show as Watching and it lands here with its next episode.'
            : readyCount > 0
                ? `${readyCount} of your shows ${readyCount === 1 ? 'has' : 'have'} a new episode waiting.`
                : 'You’re up to date. Here’s what airs next.';

    return (
        <section aria-labelledby="continue-heading" className="page-container pt-20 md:pt-32">
            <div className="grid grid-cols-[minmax(0,1fr)] gap-6 md:grid-cols-[minmax(0,5fr)_minmax(0,8fr)] md:gap-16">
                <div className="min-w-0">
                    <h1 className="page-title break-words">{user?.username || 'Welcome back'}</h1>
                    <p className="mt-3 max-w-sm text-[17px] leading-relaxed text-[var(--text-2)]">{summaryLine}</p>
                    {summary?.total > 0 && (
                        <p className="mt-3 text-[15px] text-[var(--text-3)] tabular">
                            {summary.total} on your list · {(summary.episodes_watched || 0) + episodeDelta} episodes watched
                        </p>
                    )}
                    <Tonight items={tonight} now={now} timezone={timezone} />
                </div>

                <div className="panel">
                    <h2 id="continue-heading" className="section-title mb-2">{!isPending && rows.length === 0 ? (airingSoon.length ? 'Airing soon' : 'Start watching') : 'Continue watching'}</h2>
                    {isPending ? (
                        <ul aria-hidden="true">
                            {Array.from({ length: 3 }, (_, i) => (
                                <li key={i} className="flex items-center gap-4 py-3">
                                    <Skeleton className="h-[72px] w-12 shrink-0" />
                                    <div className="flex-1">
                                        <Skeleton className="h-4 w-1/2" />
                                        <Skeleton className="mt-2 h-3.5 w-1/3" />
                                    </div>
                                </li>
                            ))}
                        </ul>
                    ) : rows.length === 0 ? (
                        <>
                            {airingSoon.length > 0 && (
                                <ul className="mb-4">
                                    {airingSoon.map((row) => (
                                        <li key={row.anime.id}>
                                            <Link to={`/anime/${row.anime.slug}`} className="group -mx-3 flex items-center gap-4 rounded-[var(--radius-md)] px-3 py-2.5 transition-colors hover:bg-white/[0.03]">
                                                <img
                                                    src={getOptimizedImageUrl(row.anime, 'cover', 'small')}
                                                    onError={(event) => applyImageFallback(event, getImageFallbackUrl(row.anime, 'cover'))}
                                                    alt=""
                                                    loading="lazy"
                                                    className="h-14 w-10 shrink-0 rounded-md bg-[var(--ink-2)] object-cover"
                                                />
                                                <span className="min-w-0 flex-1">
                                                    <span className="block truncate font-semibold text-[var(--text-1)] group-hover:text-[var(--signature)]">{row.anime.title}</span>
                                                    <span className="block text-sm text-[var(--text-2)] tabular">
                                                        {row.anime.next_airing_episode ? `Episode ${row.anime.next_airing_episode} · ` : ''}{previewWhen(row, timezone)}
                                                    </span>
                                                </span>
                                            </Link>
                                        </li>
                                    ))}
                                </ul>
                            )}
                            <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-[15px]">
                                <Link to="/browse?sort=trending" className="btn-primary px-4">Find something to watch</Link>
                                <Link to="/import" className="text-link">Import a list</Link>
                            </div>
                        </>
                    ) : (
                        <>
                            <ul>
                                {rows.map(({ entry }) => (
                                    <ContinueRow key={entry.id} entry={entry} now={now} onLive={onLive} />
                                ))}
                            </ul>
                            <Link to="/list" className="text-link mt-5 inline-block text-[15px]">All of my list</Link>
                        </>
                    )}
                </div>
            </div>
        </section>
    );
}
