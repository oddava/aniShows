import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '../../context/AuthContext';
import useListEntryMutation from '../../hooks/useListEntryMutation';
import useDelayedLoading from '../../hooks/useDelayedLoading';
import { listQueries, userQueries } from '../../api/queries/lists';
import { scheduleQueries } from '../../api/queries/anime';
import { airedEpisodeCount, knownEpisodeTotal } from '../../utils/episodes';
import { applyImageFallback, getImageFallbackUrl, getOptimizedImageUrl } from '../../utils/imageUtils';
import { formatDate } from '../../utils/dateUtils';
import ProgressStepper from '../ui/ProgressStepper';
import ScorePicker from '../ui/ScorePicker';
import Skeleton from '../ui/Skeleton';
import QuickAdd from '../ui/QuickAdd';
import ErrorState from '../common/ErrorState';
import useChangeKey from '../../hooks/useChangeKey';
import { continueState, countdown, sortForContinue } from './continueModel';
import { airingPreview, clockTime, dayOffset, previewWhen, useMinuteClock } from './airingModel';

/** Cards under the spotlight; the rest are one tap away in My list. */
const CARD_LIMIT = 6;
/** Loads faster than this show no skeleton (the space is still held). */
const SKELETON_DELAY_MS = 1000;

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

/** "Fri 19:30", "Tomorrow 19:30", "Today 19:30". */
function airsAt(at, timezone, now) {
    const offset = dayOffset(at, timezone, now);
    const day = offset === 0 ? 'Today' : offset === 1 ? 'Tomorrow' : formatDate(at, { weekday: 'short' }, timezone);
    return `${day} ${clockTime(at, timezone)}`;
}

function Banner({ anime, size, className = '', eager = false }) {
    return (
        <img
            src={getOptimizedImageUrl(anime, 'banner', size)}
            onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'banner'))}
            alt=""
            loading={eager ? 'eager' : 'lazy'}
            fetchPriority={eager ? 'high' : undefined}
            className={`h-full w-full bg-[var(--ink-2)] object-cover ${className}`}
        />
    );
}

/**
 * Shared by the spotlight and the cards: the entry's mutation, the episode
 * count on screen (a tap not yet written counts) and its state, reported up
 * so the summary line and the episode total follow a +1 in the same frame.
 */
function useContinueEntry(entry, now, onLive) {
    const anime = entry.anime || {};
    const mutation = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count, next_airing_episode: anime.next_airing_episode, next_airing_date: anime.next_airing_date },
        entry,
    });
    const [draft, setDraft] = useState(null);
    const watched = draft ?? mutation.entry.episodes_watched ?? 0;
    const state = continueState({ ...entry, episodes_watched: watched, score: mutation.entry.score }, now);
    useEffect(() => {
        onLive?.(entry.id, { kind: state.kind, delta: (watched || 0) - (entry.episodes_watched || 0) });
    }, [onLive, entry.id, entry.episodes_watched, state.kind, watched]);
    return { anime, ...mutation, setDraft, state };
}

/** Score for a finished show, +1 for the rest. */
function EntryControl({ anime, current, state, now, isPending, save, setProgress, setDraft, size }) {
    if (state.kind === 'finished') {
        return (
            <ScorePicker
                className="max-w-sm"
                size="sm"
                allowClear={false}
                disabled={isPending}
                value={current.score}
                label={`Score ${anime.title}`}
                onChange={(score) => save({ status: 'Completed', score })}
            />
        );
    }
    return (
        <ProgressStepper
            size={size}
            value={current.episodes_watched || 0}
            total={knownEpisodeTotal(anime)}
            aired={airedEpisodeCount(anime, now)}
            title={anime.title}
            onCommit={(next) => setProgress(next)}
            onDraft={setDraft}
        />
    );
}

/**
 * The first show in Continue, large: its banner beside what is next and one
 * button for the episode waiting.
 */
const Spotlight = memo(function Spotlight({ entry, now, timezone, onLive }) {
    const { anime, entry: current, setProgress, save, isPending, setDraft, state } = useContinueEntry(entry, now, onLive);
    const href = `/anime/${anime.slug}`;
    const line = stateText(state, now);

    return (
        <article aria-labelledby="spotlight-title" className="panel grid overflow-hidden p-0 md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)] md:p-0">
            <Link to={href} tabIndex={-1} aria-hidden="true" className="block aspect-[2/1] md:aspect-auto md:min-h-[18rem]">
                <Banner anime={anime} size="large" eager />
            </Link>
            <div className="flex min-w-0 flex-col gap-6 p-5 sm:p-6 md:p-8">
                <div>
                    <h3 id="spotlight-title" className="text-[1.625rem] font-semibold leading-tight tracking-[-0.02em] text-[var(--text-1)] md:text-[1.875rem]">
                        <Link to={href} className="line-clamp-2 transition-colors hover:text-[var(--signature)]">{anime.title}</Link>
                    </h3>
                    <p className="mt-2 text-[15px] text-[var(--text-2)] tabular">
                        <span className={line.accent ? 'text-[var(--signature)]' : undefined}>{line.text}</span>
                        {state.kind === 'ready' && state.nextAt && <span> · then {airsAt(state.nextAt, timezone, now)}</span>}
                        {state.kind === 'soon' && <span> · {airsAt(state.nextAt, timezone, now)}</span>}
                    </p>
                </div>
                <div className="flex flex-wrap items-center gap-3 md:mt-auto">
                    {state.kind === 'ready' && (
                        <button
                            type="button"
                            className="btn-primary"
                            disabled={isPending}
                            onClick={() => setProgress(state.nextEpisode)}
                        >
                            Watched episode {state.nextEpisode}
                        </button>
                    )}
                    <EntryControl anime={anime} current={current} state={state} now={now} isPending={isPending} save={save} setProgress={setProgress} setDraft={setDraft} />
                </div>
            </div>
        </article>
    );
});

/** One show as a wide card: banner, what's next and +1. */
const ContinueCard = memo(function ContinueCard({ entry, now, onLive }) {
    const { anime, entry: current, setProgress, save, isPending, setDraft, state } = useContinueEntry(entry, now, onLive);
    const href = `/anime/${anime.slug}`;
    const line = stateText(state, now);

    return (
        <li className="card-enter flex w-[78vw] max-w-[22rem] shrink-0 snap-start flex-col overflow-hidden rounded-[var(--radius-lg)] bg-[var(--ink-1)] sm:w-[20rem] md:w-auto md:max-w-none">
            <Link to={href} tabIndex={-1} aria-hidden="true" className="block aspect-[2/1] overflow-hidden">
                <Banner anime={anime} size="medium" />
            </Link>
            <div className="flex flex-1 flex-col gap-3 p-4">
                <div className="min-w-0">
                    <Link to={href} className="line-clamp-1 text-base font-semibold leading-snug text-[var(--text-1)] transition-colors hover:text-[var(--signature)]">
                        {anime.title}
                    </Link>
                    <p className={`mt-0.5 text-sm tabular ${line.accent ? 'text-[var(--signature)]' : 'text-[var(--text-2)]'}`}>{line.text}</p>
                </div>
                <div className="mt-auto">
                    <EntryControl anime={anime} current={current} state={state} now={now} isPending={isPending} save={save} setProgress={setProgress} setDraft={setDraft} size="sm" />
                </div>
            </div>
        </li>
    );
});

/** A fresh list's "Airing soon" row: what airs, and one tap to start it. */
function AiringSoonRow({ row, timezone }) {
    const { anime } = row;
    const { entry, setStatus, setScore, remove, isPending } = useListEntryMutation({
        anime: {
            id: anime.id, slug: anime.slug, episode_count: anime.episode_count,
            next_airing_episode: anime.next_airing_episode, next_airing_date: anime.next_airing_date,
        },
        entry: anime.user_list_status,
    });
    const total = knownEpisodeTotal(anime);
    return (
        <li className="-mx-3 flex items-center gap-3 rounded-[var(--radius-md)] px-3 py-2">
            <Link to={`/anime/${anime.slug}`} className="group flex min-w-0 flex-1 items-center gap-4">
                <img
                    src={getOptimizedImageUrl(anime, 'cover', 'small')}
                    onError={(event) => applyImageFallback(event, getImageFallbackUrl(anime, 'cover'))}
                    alt=""
                    loading="lazy"
                    className="h-14 w-10 shrink-0 rounded-md bg-[var(--ink-2)] object-cover"
                />
                <span className="min-w-0 flex-1">
                    <span className="line-clamp-3 font-semibold leading-snug text-[var(--text-1)] group-hover:text-[var(--signature)] sm:line-clamp-1">{anime.title}</span>
                    <span className="block text-sm text-[var(--text-2)] tabular">
                        {anime.next_airing_episode ? `Episode ${anime.next_airing_episode} · ` : ''}{previewWhen(row, timezone)}
                    </span>
                </span>
            </Link>
            <QuickAdd
                variant="chip"
                labelFrom="sm"
                placement="down"
                className="relative shrink-0"
                status={entry.status}
                score={entry.score}
                watched={entry.episodes_watched || 0}
                total={total}
                aired={airedEpisodeCount(anime)}
                title={anime.title}
                pending={isPending}
                onSelect={(value) => setStatus(value)}
                onScore={(value) => setScore(value)}
                onRemove={() => remove()}
            />
        </li>
    );
}

/** One number beside the greeting, linking to the list it counts. */
function ListStat({ label, value, to }) {
    const change = useChangeKey(value);
    return (
        <div className="flex flex-col-reverse">
            <dt className="mt-1 text-sm text-[var(--text-3)]">{label}</dt>
            <dd>
                <Link to={to} className="inline-flex rounded-md text-[1.75rem] font-semibold leading-none tracking-[-0.02em] text-[var(--text-1)] tabular transition-colors hover:text-[var(--signature)]">
                    <span key={change.key} className={change.changed ? `count-${change.direction}` : undefined}>{value}</span>
                </Link>
            </dd>
        </div>
    );
}

/**
 * Spotlight and cards in their final shape, so nothing moves when they land.
 * Invisible for the first second (fast loads show no loading state at all),
 * then the sweep; one announcement for the whole group.
 */
function ContinueSkeleton({ visible }) {
    return (
        <div className={visible ? undefined : 'invisible'}>
            <span className="sr-only">Loading your shows</span>
            <div aria-hidden="true">
                <div className="grid overflow-hidden rounded-[var(--radius-lg)] bg-[var(--ink-1)] md:grid-cols-[minmax(0,7fr)_minmax(0,5fr)]">
                    <Skeleton rounded="rounded-none" className="aspect-[2/1] md:aspect-auto md:min-h-[18rem]" />
                    <div className="p-5 sm:p-6 md:p-8">
                        <Skeleton className="h-8 w-3/4" />
                        <Skeleton className="mt-3 h-4 w-1/2" />
                    </div>
                </div>
                <div className="mt-5 hidden gap-5 md:grid md:grid-cols-2 lg:grid-cols-3">
                    {[0, 1, 2].map((i) => (
                        <div key={i} className="overflow-hidden rounded-[var(--radius-lg)] bg-[var(--ink-1)]">
                            <Skeleton rounded="rounded-none" className="aspect-[2/1]" />
                            <div className="p-4"><Skeleton className="h-4 w-2/3" /><Skeleton className="mt-2 h-3.5 w-1/3" /></div>
                        </div>
                    ))}
                </div>
            </div>
        </div>
    );
}

/**
 * The top of the signed-in home (L2): who you are and your list in three
 * numbers, then Continue watching: the show to watch next as a spotlight and
 * the rest as wide cards, ready ones first.
 */
export default function ContinueSection() {
    const now = useMinuteClock();
    const { user, isAuthenticated } = useAuth();
    const timezone = user?.preferred_timezone;
    // Rendered while a returning member's session is still being restored
    // (Home): the cards wait for it and the skeleton holds their place.
    const { data: watching, isPending, isError, refetch } = useQuery({
        ...userQueries.watching(),
        enabled: isAuthenticated,
        staleTime: 60 * 1000,
    });
    const { data: summary, isPending: summaryQueryPending } = useQuery({
        ...listQueries.summary(user?.username),
        enabled: Boolean(user?.username),
        staleTime: 60 * 1000,
    });
    // The same request as "Your week" below (shared cache).
    const { data: scheduleDays } = useQuery({
        ...scheduleQueries.week(isAuthenticated, Boolean(user?.show_adult_content)),
        staleTime: 5 * 60 * 1000,
        enabled: isAuthenticated,
    });
    const loading = isPending && !isError;
    const showSkeleton = useDelayedLoading(loading, SKELETON_DELAY_MS);
    const summaryPending = !isAuthenticated || (Boolean(user?.username) && summaryQueryPending);
    const showStatsSkeleton = useDelayedLoading(summaryPending, SKELETON_DELAY_MS);

    // The order is set once per visit: a card never jumps away under the
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
    const [live, setLive] = useState({});
    const onLive = useCallback((id, value) => {
        setLive((previous) => (
            previous[id]?.kind === value.kind && previous[id]?.delta === value.delta ? previous : { ...previous, [id]: value }
        ));
    }, []);
    const readyCount = rows.filter((row) => (live[row.entry.id]?.kind ?? row.state.kind) === 'ready').length;
    const episodeDelta = rows.reduce((sum, row) => sum + (live[row.entry.id]?.delta || 0), 0);
    const empty = !loading && !isError && rows.length === 0;
    // A fresh list: what airs soon, so the first screen still answers
    // "what's on" (as it does for visitors).
    const airingSoon = useMemo(
        () => (empty ? airingPreview(scheduleDays, timezone, now, 8).filter((row) => !row.aired).slice(0, 4) : []),
        [empty, scheduleDays, timezone, now],
    );
    // Said only when it is known: a failed load must not read as "nothing".
    const summaryLine = loading || isError
        ? ''
        : empty
            ? 'Nothing in progress yet.'
            : readyCount > 0
                ? `${readyCount} of your shows ${readyCount === 1 ? 'has' : 'have'} a new episode waiting.`
                : 'You’re up to date. Here’s what airs next.';
    const [spotlight, ...others] = rows;
    const cards = others.slice(0, CARD_LIMIT);

    return (
        <>
            <header className="page-container pt-[5.5rem] md:pt-20">
                <div className="flex flex-col gap-6 md:flex-row md:items-end md:justify-between md:gap-12">
                    <div className="min-w-0">
                        <h1 className="page-title break-words">{user?.username || 'Welcome back'}</h1>
                        {/* One line is held for the summary while it loads, so
                            nothing below moves when it lands. */}
                        <p className="mt-3 min-h-[1.65em] max-w-xl text-[17px] leading-relaxed text-[var(--text-2)]">{summaryLine}</p>
                    </div>
                    {summaryPending ? (
                        <div aria-hidden="true" className={`grid w-full max-w-sm grid-cols-3 gap-6 md:w-auto md:min-w-[20rem] ${showStatsSkeleton ? '' : 'invisible'}`}>
                            {[0, 1, 2].map((i) => (
                                <div key={i}>
                                    <Skeleton className="h-7 w-12" />
                                    <Skeleton className="mt-2 h-3.5 w-16" />
                                </div>
                            ))}
                        </div>
                    ) : summary?.total > 0 && (
                        <dl className="grid w-full max-w-sm shrink-0 grid-cols-3 gap-6 md:w-auto md:min-w-[20rem]">
                            <ListStat label="Watching" value={summary.counts?.Watching ?? 0} to="/list?status=watching" />
                            <ListStat label="Completed" value={summary.counts?.Completed ?? 0} to="/list?status=completed" />
                            <ListStat label="Episodes" value={(summary.episodes_watched || 0) + episodeDelta} to="/list?status=all" />
                        </dl>
                    )}
                </div>
            </header>

            {empty ? (
                <section aria-labelledby="start-heading" className="page-container">
                    <div className="panel grid gap-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-12 md:p-8">
                        <div>
                            <h2 id="start-heading" className="section-title">Start tracking a show</h2>
                            <p className="mt-2 max-w-sm text-[15px] leading-relaxed text-[var(--text-2)]">
                                Mark a show as Watching and its next episode shows up here, with +1 to log it.
                            </p>
                            <div className="mt-5 flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px]">
                                <Link to="/browse?sort=trending" className="btn-primary px-4">Find something to watch</Link>
                                <Link to="/import" className="text-link">Import a list</Link>
                            </div>
                        </div>
                        {airingSoon.length > 0 && (
                            <div>
                                <h3 className="text-[15px] font-semibold text-[var(--text-2)]">Airing soon</h3>
                                <ul className="mt-2">
                                    {airingSoon.map((row) => (
                                        <AiringSoonRow key={row.anime.id} row={row} timezone={timezone} />
                                    ))}
                                </ul>
                            </div>
                        )}
                    </div>
                </section>
            ) : (
                <section aria-labelledby="continue-heading" aria-busy={loading || undefined} className="page-container">
                    <div className="mb-5 flex min-h-11 items-center justify-between gap-4">
                        <h2 id="continue-heading" className="section-title">Continue watching</h2>
                        {!loading && !isError && <Link to="/list" className="text-link shrink-0 text-[15px]">All of my list</Link>}
                    </div>
                    {isError ? (
                        <ErrorState
                            title="Your shows didn’t load"
                            message="Your list is safe; this part of the page couldn’t reach it. Try again in a moment."
                            onRetry={refetch}
                        />
                    ) : loading ? (
                        <ContinueSkeleton visible={showSkeleton} />
                    ) : (
                        <>
                            <Spotlight entry={spotlight.entry} now={now} timezone={timezone} onLive={onLive} />
                            {cards.length > 0 && (
                                <ul className="-mx-4 mt-5 flex snap-x snap-mandatory gap-4 overflow-x-auto overscroll-x-contain px-4 pb-1 scroll-px-4 scrollbar-hide md:mx-0 md:grid md:snap-none md:grid-cols-2 md:gap-5 md:overflow-visible md:px-0 md:pb-0 lg:grid-cols-3">
                                    {cards.map(({ entry }) => (
                                        <ContinueCard key={entry.id} entry={entry} now={now} onLive={onLive} />
                                    ))}
                                </ul>
                            )}
                        </>
                    )}
                </section>
            )}
        </>
    );
}
