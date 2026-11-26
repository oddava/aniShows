import { Link } from 'react-router-dom';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAuth } from '../context/AuthContext';
import useListEntryMutation from '../hooks/useListEntryMutation';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getImageSrcSet,
    getOptimizedImageUrl,
} from '../utils/imageUtils';
import { statusMeta } from '../utils/listStatus';
import { cachedCoverAccent, coverAccent } from '../utils/coverAccent';
import { airedEpisodeCount, knownEpisodeTotal, progressPercent } from '../utils/episodes';
import QuickAdd from './ui/QuickAdd';
import ProgressStepper from './ui/ProgressStepper';
import { ScoreBadge } from './ui/Badge';
import { CardSkeleton } from './ui/Skeleton';

// Covers that have finished loading this visit, with the URL that actually
// loaded (a fallback, when the optimised copy was missing). A card showing one
// again (Back to a grid, a shelf re-rendered) starts visible on that URL
// instead of fading in from blank a second time.
const loadedCovers = new Map();

function timeUntil(dateString) {
    if (!dateString) return null;
    const diff = new Date(dateString).getTime() - Date.now();
    if (!Number.isFinite(diff)) return null;
    if (diff < 0) return 'aired';
    const minutes = Math.floor(diff / 60000);
    const hours = Math.floor(minutes / 60);
    if (hours < 1) return `${minutes}m`;
    if (hours < 24) return `${hours}h ${minutes % 60}m`;
    return `${Math.floor(hours / 24)}d ${hours % 24}h`;
}

/**
 * The one anime card (B4): poster, your status dot, your score, progress and
 * quick add, everywhere a show is listed (home, browse, search, schedule,
 * library). Every list write goes through useListEntryMutation, so each
 * change raises the same toast with Undo (T6).
 *
 * `showProgress`: Watching entries get a visible − n / total + stepper under
 * the poster (T3); otherwise progress is a thin bar on the poster.
 */
function AnimeCard({
    anime,
    userListEntry,
    titleLanguage = 'en',
    lite = false,
    priority = false,
    index = 0,
    showAiringCountdown = false,
    showMeta = false,
    metaText = null,
    showProgress = false,
    variant = 'poster',
    showStatusDot = true,
    // The first six cards of a grid load eagerly (they are on screen). Rows
    // that decide for themselves (Browse shelves: only the first shelf) say
    // so with `priority` and turn this off.
    eagerFirstSix = true,
}) {
    const { isAuthenticated } = useAuth();
    const listEntry = userListEntry || anime.user_list_status || null;
    const { entry, setStatus, setScore, setProgress, remove, isPending } = useListEntryMutation({
        anime: { id: anime.id, slug: anime.slug, episode_count: anime.episode_count, next_airing_episode: anime.next_airing_episode, next_airing_date: anime.next_airing_date },
        entry: listEntry,
    });

    const imageRef = useRef(null);
    const cardRef = useRef(null);

    const imageUrl = useMemo(() => getOptimizedImageUrl(anime, 'cover', 'medium'), [anime]);

    // Hovering a card tints its title with the cover's dominant colour. It is
    // sampled on first hover (from the loaded poster, so usually no request)
    // and written straight to a CSS variable, so the card doesn't re-render.
    const tintTitle = useCallback(() => {
        const img = imageRef.current;
        const card = cardRef.current;
        if (!img || !card) return;
        coverAccent(img, imageUrl, [
            getOptimizedImageUrl(anime, 'cover', 'small'),
            imageUrl,
            getImageFallbackUrl(anime, 'cover'),
        ]).then((color) => {
            if (color) card.style.setProperty('--cover-accent', color);
        });
    }, [anime, imageUrl]);
    const [imageLoaded, setImageLoaded] = useState(() => loadedCovers.has(imageUrl));
    const markLoaded = useCallback((event) => {
        const loadedFrom = event?.currentTarget?.currentSrc || loadedCovers.get(imageUrl) || imageUrl;
        if (imageUrl) loadedCovers.set(imageUrl, loadedFrom);
        setImageLoaded(true);
    }, [imageUrl]);
    const imageSrcSet = useMemo(() => getImageSrcSet(anime, 'cover'), [anime]);
    const fallbackImageUrl = useMemo(() => getImageFallbackUrl(anime, 'cover'), [anime]);
    // Remembered from an earlier load: start on the URL that worked. Read once
    // per cover (not every render), so a first load never swaps its own src.
    const [remembered, setRemembered] = useState(() => ({ url: imageUrl, src: loadedCovers.get(imageUrl) }));
    if (remembered.url !== imageUrl) setRemembered({ url: imageUrl, src: loadedCovers.get(imageUrl) });
    const knownSrc = remembered.url === imageUrl ? remembered.src : undefined;
    const posterSrc = knownSrc || imageUrl;
    const posterSrcSet = knownSrc && knownSrc !== imageUrl ? undefined : imageSrcSet;

    useEffect(() => {
        setImageLoaded(loadedCovers.has(imageUrl));
        const frame = requestAnimationFrame(() => {
            if (imageRef.current?.complete && imageRef.current.naturalWidth > 0) markLoaded();
        });
        return () => cancelAnimationFrame(frame);
    }, [imageUrl, markLoaded]);

    // A missing optimised cover swaps to the original; the skeleton stays and
    // the fallback fades in on its own load.
    const handleImageError = useCallback((event) => {
        // applyImageFallback retries in steps (cache-bust, then the original);
        // stop waiting only once its last step has failed too.
        if (event.currentTarget.dataset.fallbackApplied === '1') {
            setImageLoaded(true);
            return;
        }
        applyImageFallback(event, fallbackImageUrl);
    }, [fallbackImageUrl]);

    const displayTitle = titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title;
    const status = entry.status;
    const meta = statusMeta(status);
    const isWatching = status === 'Watching';
    const total = knownEpisodeTotal(anime);
    const aired = airedEpisodeCount(anime);
    const watched = entry.episodes_watched || 0;
    const percent = isWatching ? progressPercent(watched, anime) : null;

    const countdown = useMemo(() => {
        if (!showAiringCountdown) return null;
        const left = timeUntil(anime.next_airing_date);
        if (!left) return null;
        const ep = anime.next_airing_episode ? `Ep ${anime.next_airing_episode}` : 'Next ep';
        return left === 'aired' ? `${ep} is out` : `${ep} in ${left}`;
    }, [showAiringCountdown, anime.next_airing_date, anime.next_airing_episode]);

    const metaLine = useMemo(() => {
        if (metaText) return metaText;
        if (!showMeta) return null;
        const year = anime.release_date ? new Date(anime.release_date).getFullYear() : null;
        return [anime.anime_type, Number.isFinite(year) ? year : null].filter(Boolean).join(' · ') || null;
    }, [metaText, showMeta, anime.anime_type, anime.release_date]);

    const loading = priority || (eagerFirstSix && index < 6) ? 'eager' : 'lazy';
    // The first posters on screen are the page's largest paint: fetch them first.
    const fetchPriority = priority || (eagerFirstSix && index < 4) ? 'high' : undefined;
    const href = `/anime/${anime.slug}`;
    const smallUrl = getOptimizedImageUrl(anime, 'cover', 'small');
    const placeholderUrl = !lite && smallUrl && smallUrl !== imageUrl ? smallUrl : null;
    const knownAccent = cachedCoverAccent(imageUrl);

    if (variant === 'row') {
        // The agenda row (Schedule): same facts and quick add, laid out like
        // oddava.me's list rows: thumb, title and what's next, action right.
        return (
            <article ref={cardRef} onPointerEnter={tintTitle} style={knownAccent ? { '--cover-accent': knownAccent } : undefined} className="group -mx-3 grid grid-cols-[3rem_minmax(0,1fr)_auto] items-center gap-x-4 rounded-[var(--radius-md)] px-3 py-3 transition-colors hover:bg-white/[0.03]" aria-label={displayTitle}>
                <Link to={href} tabIndex={-1} aria-hidden="true" className="relative block h-[72px] w-12 overflow-hidden rounded-md bg-[var(--ink-2)]">
                    <img
                        ref={imageRef}
                        src={getOptimizedImageUrl(anime, 'cover', 'small') || imageUrl}
                        alt=""
                        loading={loading}
                        decoding="async"
                        onLoad={() => setImageLoaded(true)}
                        onError={handleImageError}
                        data-loaded={imageLoaded}
                        className="img-fade h-full w-full object-cover"
                    />
                </Link>
                <div className="min-w-0">
                    <Link to={href} className="flex items-start gap-1.5">
                        <span className="line-clamp-2 text-base font-semibold leading-snug tracking-[-0.01em] text-[var(--text-1)] group-hover:text-[var(--cover-accent,var(--signature))]">{displayTitle}</span>
                    </Link>
                    <p className="mt-0.5 text-sm text-[var(--text-2)] tabular">
                        {meta && <span className="sm:hidden" style={{ color: meta.color }}>{meta.label} · </span>}
                        {[metaLine, countdown].filter(Boolean).join(' · ')}
                    </p>
                    {meta && <span className="sr-only">On your list: {meta.label}</span>}
                </div>
                {isAuthenticated ? (
                    <QuickAdd
                        status={status}
                        score={entry.score}
                        watched={watched}
                        total={total}
                        aired={aired}
                        title={displayTitle}
                        pending={isPending}
                        onSelect={(value) => setStatus(value)}
                        onScore={(value) => setScore(value)}
                        onRemove={() => remove()}
                        placement="down"
                        variant="chip"
                        labelFrom="sm"
                        className="relative"
                    />
                ) : <span />}
            </article>
        );
    }

    if (lite) {
        return (
            <Link to={href} className="group relative block aspect-[2/3] overflow-hidden rounded-[var(--radius-md)] bg-[var(--ink-2)]">
                <img
                    ref={imageRef}
                    src={imageUrl}
                    srcSet={imageSrcSet}
                    sizes="(max-width: 767px) 160px, (max-width: 1023px) 33vw, 20vw"
                    alt={anime.title}
                    draggable={false}
                    loading={loading}
                    decoding="async"
                    onLoad={markLoaded}
                    onError={handleImageError}
                    data-loaded={imageLoaded}
                    className="img-fade h-full w-full object-cover"
                />
            </Link>
        );
    }

    return (
        <article
            ref={cardRef}
            onPointerEnter={tintTitle}
            className="card-enter group relative flex h-full flex-col"
            style={knownAccent ? { '--cover-accent': knownAccent } : undefined}
            aria-label={displayTitle}
        >
            <div className="relative aspect-[2/3] shrink-0 rounded-[var(--radius-md)] bg-[var(--ink-2)] has-[a:focus-visible]:shadow-[0_0_0_2px_var(--signature)]">
                <Link
                    to={href}
                    aria-label={displayTitle}
                    className="absolute inset-0 block overflow-hidden rounded-[var(--radius-md)] focus-visible:!outline-none focus-visible:!shadow-none"
                >
                    {!imageLoaded && <div aria-hidden="true" className="absolute inset-0 skeleton-shimmer rounded-[var(--radius-md)]" />}
                    {placeholderUrl && (
                        <img
                            aria-hidden="true"
                            alt=""
                            src={placeholderUrl}
                            data-hidden={imageLoaded}
                            onError={(event) => { event.currentTarget.style.display = 'none'; }}
                            className="poster-blur absolute inset-0 h-full w-full object-cover"
                        />
                    )}
                    <img
                        ref={imageRef}
                        src={posterSrc}
                        srcSet={posterSrcSet}
                        sizes="(max-width: 767px) 160px, (max-width: 1023px) 33vw, 20vw"
                        alt=""
                        draggable={false}
                        loading={loading}
                        fetchPriority={fetchPriority}
                        decoding="async"
                        onLoad={markLoaded}
                        onError={handleImageError}
                        data-loaded={imageLoaded}
                        className="img-fade relative h-full w-full object-cover"
                    />
                </Link>

                {entry.score > 0 && (
                    <ScoreBadge score={entry.score} className="pointer-events-none absolute left-2 top-2" />
                )}

                {countdown && (
                    <span className="pointer-events-none absolute bottom-2 left-2 right-12 truncate rounded-[var(--radius-sm)] bg-[rgb(11_13_16/0.82)] px-2 py-1 text-[11px] font-semibold text-white backdrop-blur-sm tabular">
                        {countdown}
                    </span>
                )}

                {percent !== null && !showProgress && (
                    <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] overflow-hidden rounded-b-[var(--radius-md)] bg-black/50">
                        <span className="progress-fill block h-full bg-[var(--status-watching)]" style={{ '--progress': percent / 100 }} />
                    </span>
                )}

                {isAuthenticated && (
                    <QuickAdd
                        status={status}
                        score={entry.score}
                        watched={watched}
                        total={total}
                        aired={aired}
                        title={displayTitle}
                        pending={isPending}
                        onSelect={(value) => setStatus(value)}
                        onScore={(value) => setScore(value)}
                        onRemove={() => remove()}
                        className="card-reveal absolute bottom-2 right-2 z-20"
                    />
                )}
            </div>


            {/* The poster link is the tab stop; this one repeats it for pointers. */}
            <Link to={href} className="mt-2.5 block" tabIndex={-1} aria-hidden="true">
                <span className="flex items-start gap-1.5">
                    {meta && showStatusDot && (
                        <span
                            className="mt-[0.4rem] h-2 w-2 shrink-0 rounded-full [@media(hover:none)]:hidden"
                            style={{ backgroundColor: meta.color }}
                        />
                    )}
                    <span className="line-clamp-2 text-[13.5px] font-medium leading-[1.3] text-gray-200 transition-colors duration-200 group-hover:text-[var(--cover-accent,#fff)]">
                        {displayTitle}
                    </span>
                </span>
                {metaLine && (
                    <span className="mt-1 block truncate text-xs text-gray-500 tabular">{metaLine}</span>
                )}
            </Link>
            {meta && <span className="sr-only">On your list: {meta.label}</span>}
            {isAuthenticated && showProgress && isWatching && (
                <div className="mt-auto flex pt-2">
                    <ProgressStepper
                        size="sm"
                        value={watched}
                        total={total}
                        aired={aired}
                        title={displayTitle}
                        onCommit={(next) => setProgress(next)}
                    />
                </div>
            )}
        </article>
    );
}

const arePropsEqual = (prev, next) => {
    if (prev.anime !== next.anime && prev.anime.id !== next.anime.id) return false;
    if (prev.titleLanguage !== next.titleLanguage) return false;
    if (prev.lite !== next.lite) return false;
    if (prev.priority !== next.priority) return false;
    if (prev.index !== next.index) return false;
    if (prev.showAiringCountdown !== next.showAiringCountdown) return false;
    if (prev.showMeta !== next.showMeta) return false;
    if (prev.metaText !== next.metaText) return false;
    if (prev.showProgress !== next.showProgress) return false;
    if (prev.variant !== next.variant) return false;
    if (prev.showStatusDot !== next.showStatusDot) return false;
    if (prev.eagerFirstSix !== next.eagerFirstSix) return false;
    if (prev.anime.episode_count !== next.anime.episode_count) return false;
    if (prev.anime.next_airing_date !== next.anime.next_airing_date) return false;

    const a = prev.userListEntry || prev.anime.user_list_status;
    const b = next.userListEntry || next.anime.user_list_status;
    if (!!a !== !!b) return false;
    return a?.id === b?.id
        && a?.status === b?.status
        && a?.episodes_watched === b?.episodes_watched
        && a?.score === b?.score;
};

export default React.memo(AnimeCard, arePropsEqual);

/** Same geometry as AnimeCard, so nothing moves when data lands. */
export function AnimeCardSkeleton() {
    return <CardSkeleton />;
}
