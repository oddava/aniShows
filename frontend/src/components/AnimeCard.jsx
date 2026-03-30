import { Link } from 'react-router-dom';
import { Plus, Check, Eye, Clock, X, Loader2 } from 'lucide-react';
import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useAuth } from '../context/AuthContext';
import { listApi } from '../api/client';
import useColorExtraction from '../hooks/useColorExtraction';
import {
    applyImageFallback,
    getImageFallbackUrl,
    getImageSrcSet,
    getOptimizedImageUrl,
    isSameOriginImageUrl,
} from '../utils/imageUtils';
import logger from '../utils/logger';

const STATUS_OPTIONS = [
    { value: 'Watching', label: 'Watching', icon: Eye, color: 'text-emerald-400', bgColor: 'bg-emerald-500/20 border-emerald-500/40', dotColor: 'bg-emerald-400' },
    { value: 'Completed', label: 'Completed', icon: Check, color: 'text-blue-400', bgColor: 'bg-blue-500/20 border-blue-500/40', dotColor: 'bg-blue-400' },
    { value: 'Plan to Watch', label: 'Planning', icon: Clock, color: 'text-slate-300', bgColor: 'bg-slate-500/20 border-slate-400/40', dotColor: 'bg-slate-400' },
];

function normalizeHexColor(value) {
    if (!value || typeof value !== 'string') return null;
    const hex = value.trim();
    const shortMatch = /^#([a-f\d]{3})$/i.exec(hex);
    if (shortMatch) {
        const expanded = shortMatch[1].split('').map((ch) => ch + ch).join('');
        return `#${expanded.toLowerCase()}`;
    }
    return /^#([a-f\d]{6})$/i.test(hex) ? hex.toLowerCase() : null;
}

function hexToRgb(hex) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;
    const raw = normalized.slice(1);
    return {
        r: parseInt(raw.slice(0, 2), 16),
        g: parseInt(raw.slice(2, 4), 16),
        b: parseInt(raw.slice(4, 6), 16),
    };
}

function rgbToHex(r, g, b) {
    const clamp = (v) => Math.max(0, Math.min(255, Math.round(v)));
    return `#${[clamp(r), clamp(g), clamp(b)].map((n) => n.toString(16).padStart(2, '0')).join('')}`;
}

function srgbToLinear(channel) {
    const c = channel / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

function relativeLuminance({ r, g, b }) {
    return 0.2126 * srgbToLinear(r) + 0.7152 * srgbToLinear(g) + 0.0722 * srgbToLinear(b);
}

function contrastRatio(hexA, hexB) {
    const rgbA = hexToRgb(hexA);
    const rgbB = hexToRgb(hexB);
    if (!rgbA || !rgbB) return 1;
    const l1 = relativeLuminance(rgbA);
    const l2 = relativeLuminance(rgbB);
    const lighter = Math.max(l1, l2);
    const darker = Math.min(l1, l2);
    return (lighter + 0.05) / (darker + 0.05);
}

function rgbToHsl({ r, g, b }) {
    const rn = r / 255;
    const gn = g / 255;
    const bn = b / 255;
    const max = Math.max(rn, gn, bn);
    const min = Math.min(rn, gn, bn);
    let h = 0;
    let s = 0;
    const l = (max + min) / 2;

    if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
            case rn:
                h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
                break;
            case gn:
                h = ((bn - rn) / d + 2) / 6;
                break;
            case bn:
                h = ((rn - gn) / d + 4) / 6;
                break;
            default:
                break;
        }
    }

    return { h: h * 360, s: s * 100, l: l * 100 };
}

function mixTowardWhite(hex, amount) {
    const rgb = hexToRgb(hex);
    if (!rgb) return null;
    const t = Math.max(0, Math.min(1, amount));
    const r = rgb.r + (255 - rgb.r) * t;
    const g = rgb.g + (255 - rgb.g) * t;
    const b = rgb.b + (255 - rgb.b) * t;
    return rgbToHex(r, g, b);
}

function ensureReadableAccent(hex, backgroundHex = '#0b0f14', minContrast = 4.5) {
    const normalized = normalizeHexColor(hex);
    if (!normalized) return null;

    if (contrastRatio(normalized, backgroundHex) >= minContrast) {
        return normalized;
    }

    let best = normalized;
    for (let i = 1; i <= 10; i += 1) {
        const candidate = mixTowardWhite(normalized, i * 0.1);
        if (!candidate) continue;
        best = candidate;
        if (contrastRatio(candidate, backgroundHex) >= minContrast) {
            return candidate;
        }
    }
    return best;
}

function selectReadableBannerAccent(colors, backgroundHex = '#0b0f14') {
    const rawCandidates = [
        colors?.primary,
        colors?.accent,
        colors?.secondary,
        ...(colors?.palette || []),
    ];

    const candidates = [...new Set(rawCandidates.map(normalizeHexColor).filter(Boolean))];
    if (!candidates.length) return null;

    candidates.sort((a, b) => {
        const aRgb = hexToRgb(a);
        const bRgb = hexToRgb(b);
        const aHsl = aRgb ? rgbToHsl(aRgb) : { s: 0 };
        const bHsl = bRgb ? rgbToHsl(bRgb) : { s: 0 };
        const aContrast = contrastRatio(a, backgroundHex);
        const bContrast = contrastRatio(b, backgroundHex);
        const aReadable = aContrast >= 3.2 ? 1 : 0;
        const bReadable = bContrast >= 3.2 ? 1 : 0;

        if (aReadable !== bReadable) return bReadable - aReadable;
        if (Math.abs(aHsl.s - bHsl.s) > 1) return bHsl.s - aHsl.s;
        return bContrast - aContrast;
    });

    return ensureReadableAccent(candidates[0], backgroundHex, 4.5);
}

function getTimeRemainingLabel(dateString) {
    if (!dateString) return null;
    const target = new Date(dateString);
    if (isNaN(target.getTime())) return null;

    const now = new Date();
    const diff = target - now;
    if (diff < 0) return 'Aired';

    const hours = Math.floor(diff / (1000 * 60 * 60));
    const minutes = Math.floor((diff % (1000 * 60 * 60)) / (1000 * 60));

    if (hours < 1) return `${minutes}m`;
    if (hours < 24) return `${hours}h ${minutes}m`;

    const days = Math.floor(hours / 24);
    return `${days}d ${hours % 24}h`;
}

function AnimeCard({
    anime,
    userListEntry,
    titleLanguage = 'en',
    lite = false,
    priority = false,
    index = 0,
    useBannerAccentTitleHover = true,
    showAiringCountdown = false
}) {
    const { isAuthenticated } = useAuth();
    const queryClient = useQueryClient();

    // Simple state - no debounced hover
    const [isLoading, setIsLoading] = useState(false);
    const [showStatusMenu, setShowStatusMenu] = useState(false);
    const [listStatus, setListStatus] = useState(userListEntry?.status || anime.user_list_status?.status || null);
    const [listId, setListId] = useState(userListEntry?.id || anime.user_list_status?.id || null);
    const [localEpisodesWatched, setLocalEpisodesWatched] = useState(
        userListEntry?.episodes_watched || anime.user_list_status?.episodes_watched || 0
    );

    const [imageLoaded, setImageLoaded] = useState(false);
    const imageRef = useRef(null);
    const statusMenuRef = useRef(null);

    // Memoized computed values - use optimized images with srcset
    const imageUrl = useMemo(() => getOptimizedImageUrl(anime, 'cover', 'medium'), [anime]);
    const imageSrcSet = useMemo(() => getImageSrcSet(anime, 'cover'), [anime]);
    const fallbackImageUrl = useMemo(() => getImageFallbackUrl(anime, 'cover'), [anime]);
    const bannerAccentImageUrl = useMemo(() => {
        if (!useBannerAccentTitleHover) return null;

        const candidates = [
            anime.banner_image_medium,
            anime.banner_image,
            imageUrl,
            anime.banner_image_external_url,
        ].filter(Boolean);

        const sameOriginCandidate = candidates.find(isSameOriginImageUrl);
        return sameOriginCandidate || null;
    }, [
        useBannerAccentTitleHover,
        anime.banner_image_medium,
        anime.banner_image,
        anime.banner_image_external_url,
        imageUrl
    ]);
    const { colors: bannerColors } = useColorExtraction(bannerAccentImageUrl);
    const titleHoverColor = useMemo(
        () => {
            if (!useBannerAccentTitleHover) return 'var(--color-accent)';
            return selectReadableBannerAccent(bannerColors) || 'var(--color-accent)';
        },
        [useBannerAccentTitleHover, bannerColors]
    );
    const displayTitle = useMemo(() =>
        titleLanguage === 'jp' && anime.title_jp ? anime.title_jp : anime.title,
        [titleLanguage, anime.title_jp, anime.title]
    );
    const airingCountdown = useMemo(() => {
        if (!showAiringCountdown) return null;
        const timeRemaining = getTimeRemainingLabel(anime.next_airing_date);
        if (!timeRemaining) return null;

        const episodeLabel = anime.next_airing_episode ? `EP ${anime.next_airing_episode}` : 'Episode';
        return timeRemaining === 'Aired'
            ? `${episodeLabel} Aired`
            : `${episodeLabel} in ${timeRemaining}`;
    }, [showAiringCountdown, anime.next_airing_date, anime.next_airing_episode]);

    const invalidateAnimeViews = useCallback(() => {
        queryClient.invalidateQueries({ queryKey: ['anime'] });
        queryClient.invalidateQueries({ queryKey: ['seasonal'] });
    }, [queryClient]);

    useEffect(() => {
        setImageLoaded(false);
    }, [imageUrl]);

    useEffect(() => {
        const frame = requestAnimationFrame(() => {
            const img = imageRef.current;
            if (img?.complete) {
                setImageLoaded(true);
            }
        });

        return () => cancelAnimationFrame(frame);
    }, [imageUrl]);

    useEffect(() => {
        setListStatus(userListEntry?.status || anime.user_list_status?.status || null);
        setListId(userListEntry?.id || anime.user_list_status?.id || null);
        setLocalEpisodesWatched(
            userListEntry?.episodes_watched || anime.user_list_status?.episodes_watched || 0
        );
    }, [
        anime.id,
        userListEntry?.status,
        userListEntry?.id,
        userListEntry?.episodes_watched,
        anime.user_list_status?.status,
        anime.user_list_status?.id,
        anime.user_list_status?.episodes_watched
    ]);

    useEffect(() => {
        function handleClickOutside(event) {
            if (statusMenuRef.current && !statusMenuRef.current.contains(event.target)) {
                setShowStatusMenu(false);
            }
        }
        if (showStatusMenu) {
            document.addEventListener('mousedown', handleClickOutside);
        }
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, [showStatusMenu]);
    const currentStatusOption = useMemo(() =>
        STATUS_OPTIONS.find(s => s.value === listStatus),
        [listStatus]
    );

    const episodesWatched = localEpisodesWatched;

    // Determine loading strategy based on priority and index
    const loadingStrategy = useMemo(() => {
        if (priority || index < 6) {
            return { loading: 'eager', decoding: 'sync' };
        }
        return { loading: 'lazy', decoding: 'async' };
    }, [priority, index]);

    const handleStatusChange = useCallback(async (e, newStatus) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isAuthenticated || isLoading) return;

        const previousStatus = listStatus;
        const previousId = listId;

        setListStatus(newStatus);
        setShowStatusMenu(false);

        setIsLoading(true);
        try {
            if (listId) {
                await listApi.update(listId, { status: newStatus });
            } else {
                const response = await listApi.add({ anime_id: anime.id, status: newStatus });
                setListId(response.data.id);
            }
            invalidateAnimeViews();
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
        } catch (error) {
            logger.error('Error updating list:', error);
            setListStatus(previousStatus);
            setListId(previousId);
        } finally {
            setIsLoading(false);
        }
    }, [anime.id, isAuthenticated, isLoading, listId, listStatus, queryClient, invalidateAnimeViews]);

    const handleRemoveFromList = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!listId || isLoading) return;

        const previousStatus = listStatus;
        const previousId = listId;

        setListStatus(null);
        setListId(null);
        setShowStatusMenu(false);

        setIsLoading(true);
        try {
            await listApi.remove(previousId);
            invalidateAnimeViews();
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
        } catch (error) {
            logger.error('Error removing from list:', error);
            setListStatus(previousStatus);
            setListId(previousId);
        } finally {
            setIsLoading(false);
        }
    }, [listId, listStatus, isLoading, queryClient, invalidateAnimeViews]);

    const handleQuickProgress = useCallback(async (e) => {
        e.preventDefault();
        e.stopPropagation();
        if (isLoading) return;

        const previousEpisodes = localEpisodesWatched;
        const newEpisodes = previousEpisodes + 1;
        setLocalEpisodesWatched(newEpisodes);
        setIsLoading(true);

        try {
            const entryId = userListEntry?.id || listId;
            await listApi.update(entryId, { episodes_watched: newEpisodes });
            invalidateAnimeViews();
            queryClient.invalidateQueries({ queryKey: ['lists'] });
            queryClient.invalidateQueries({ queryKey: ['ownProfile'] });
        } catch (error) {
            logger.error("Failed to update progress", error);
            setLocalEpisodesWatched(previousEpisodes);
        } finally {
            setIsLoading(false);
        }
    }, [localEpisodesWatched, userListEntry?.id, listId, isLoading, queryClient, invalidateAnimeViews]);

    const toggleStatusMenu = useCallback((e) => {
        e.preventDefault();
        e.stopPropagation();
        if (!isLoading) setShowStatusMenu(prev => !prev);
    }, [isLoading]);

    const handleImageError = useCallback((event) => {
        applyImageFallback(event, fallbackImageUrl);
        // Prevent permanent skeleton state if primary + fallback both fail.
        setImageLoaded(true);
    }, [fallbackImageUrl]);

    if (lite) {
        return (
            <Link
                to={`/anime/${anime.slug}`}
                className="block aspect-[2/3] rounded-lg overflow-hidden relative group"
            >
                {!imageLoaded && (
                    <div className="absolute inset-0 skeleton-shimmer bg-dark-200 z-10 pointer-events-none" />
                )}
                <img
                    ref={imageRef}
                    src={imageUrl}
                    srcSet={imageSrcSet}
                    sizes="(max-width: 767px) 160px, (max-width: 1023px) 33vw, 20vw"
                    alt={anime.title}
                    draggable={false}
                    loading={loadingStrategy.loading}
                    decoding={loadingStrategy.decoding}
                    onLoad={() => setImageLoaded(true)}
                    onError={handleImageError}
                    className={`w-full h-full object-cover ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                />
                <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity">
                    <div className="absolute bottom-2 left-2 right-2">
                        <h3 className="text-xs font-bold text-white line-clamp-2">{displayTitle}</h3>
                    </div>
                </div>
            </Link>
        );
    }

    return (
        <div
            className="group relative block h-full overflow-visible hover:z-[150]"
            style={{ '--anime-title-hover-color': titleHoverColor }}
        >
            <div className="flex flex-col h-full">
                {/* Image Container */}
                <div className="relative aspect-[2/3] overflow-hidden rounded-lg bg-dark-50 flex-shrink-0">
                    <Link to={`/anime/${anime.slug}`} className="block w-full h-full">
                        {!imageLoaded && (
                            <div className="absolute inset-0 skeleton-shimmer bg-dark-200 z-10 pointer-events-none" />
                        )}
                        <img
                            ref={imageRef}
                            src={imageUrl}
                            srcSet={imageSrcSet}
                            sizes="(max-width: 767px) 160px, (max-width: 1023px) 33vw, 20vw"
                            alt={anime.title}
                            draggable={false}
                            loading={loadingStrategy.loading}
                            decoding={loadingStrategy.decoding}
                            onLoad={() => setImageLoaded(true)}
                            onError={handleImageError}
                            className={`w-full h-full object-cover transition-opacity duration-300 ${imageLoaded ? 'opacity-100' : 'opacity-0'}`}
                        />
                    </Link>



                    {/* Status Button */}
                    {isAuthenticated && (
                        <div className="absolute bottom-2 right-2 z-[200] opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-within:opacity-100">
                            <div className="relative" ref={statusMenuRef}>
                                <button
                                    onClick={toggleStatusMenu}
                                    disabled={isLoading}
                                    className={`w-7 h-7 sm:w-8 sm:h-8 flex items-center justify-center rounded-md sm:rounded-lg shadow-none border transition-colors duration-200 touch-manipulation
                                        ${listStatus && currentStatusOption
                                            ? `${currentStatusOption.bgColor} ${currentStatusOption.color}`
                                            : 'bg-black/60 backdrop-blur-md text-white border-white/20 hover:bg-black/80 hover:border-white/30'}`}
                                    title={listStatus && currentStatusOption ? currentStatusOption.label : 'Add to List'}
                                >
                                    {isLoading ? <Loader2 className="w-3 h-3 sm:w-3.5 sm:h-3.5 animate-spin" /> :
                                        listStatus && currentStatusOption ? <currentStatusOption.icon className="w-3 h-3 sm:w-3.5 sm:h-3.5 stroke-[2.5]" /> : <Plus className="w-3.5 h-3.5 sm:w-4 sm:h-4 stroke-[2.5]" />}
                                </button>

                                {showStatusMenu && (
                                    <div className="absolute right-0 bottom-full mb-2 w-36 bg-dark-100 border border-gray-700 rounded-lg shadow-none z-[210] animate-fade-in overflow-hidden">
                                        <div className="p-1">
                                            {STATUS_OPTIONS.map((option) => (
                                                <button
                                                    key={option.value}
                                                    onClick={(e) => handleStatusChange(e, option.value)}
                                                    className={`w-full px-2.5 py-1.5 flex items-center gap-2 text-[11px] font-semibold rounded-md transition-colors touch-manipulation
                                                        ${listStatus === option.value ? 'bg-accent text-white' : `text-gray-300 hover:bg-white/10 ${option.color}`}`}
                                                >
                                                    <option.icon className="w-3 h-3" />
                                                    {option.label}
                                                </button>
                                            ))}
                                        </div>
                                        {listStatus && (
                                            <div className="p-1 border-t border-gray-800 bg-black/20">
                                                <button onClick={handleRemoveFromList} className="w-full px-2.5 py-1.5 flex items-center gap-2 text-[11px] font-bold text-red-400 hover:bg-red-400/10 rounded-md touch-manipulation">
                                                    <X className="w-3 h-3" /> Remove
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Progress Bar */}
                    {listStatus === 'Watching' && anime.episode_count && (
                        <div className="absolute bottom-0 left-0 right-0 h-1.5 bg-black/60 z-20 overflow-hidden">
                            <div
                                style={{ width: `${Math.min((episodesWatched / anime.episode_count) * 100, 100)}%` }}
                                className={`h-full transition-all duration-700 ease-out ${episodesWatched >= anime.episode_count
                                    ? 'bg-green-500 '
                                    : 'bg-accent '}`}
                            />
                        </div>
                    )}
                    {airingCountdown && (
                        <div className="absolute bottom-2 left-2 right-2 z-30 pointer-events-none">
                            <div className="h-7 px-2.5 rounded-md backdrop-blur-md flex items-center bg-black/65 text-gray-100">
                                <span className="text-[11px] font-medium tracking-wide text-gray-100">
                                    {airingCountdown}
                                </span>
                            </div>
                        </div>
                    )}
                    {/* Quick progress button */}
                    {isAuthenticated && listStatus === 'Watching' && (
                        <button
                            onClick={handleQuickProgress}
                            className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-10 h-10 sm:w-12 sm:h-12 flex items-center justify-center rounded-full bg-black/60 backdrop-blur-md text-white shadow-none opacity-0 group-hover:opacity-100 transition-opacity duration-200 cursor-pointer z-40 border border-white/20 hover:bg-black/80 hover:border-white/30 touch-manipulation"
                            title={`Mark episode ${episodesWatched + 1} as watched`}
                        >
                            {isLoading ? (
                                <Loader2 className="w-6 h-6 animate-spin" />
                            ) : (
                                <Plus className="w-7 h-7 stroke-[3]" />
                            )}
                        </button>
                    )}

                </div>

                {/* Title/Info Footer */}
                <Link to={`/anime/${anime.slug}`} className="mt-3 block"
                >
                    <div className="flex items-start gap-1.5">
                        {listStatus && currentStatusOption && (
                            <span
                                aria-hidden="true"
                                className={`mt-[0.28rem] h-2 w-2 shrink-0 rounded-full ${currentStatusOption.dotColor}`}
                            />
                        )}
                        {listStatus === 'Watching' && anime.episode_count && (
                            <span className="mt-[0.06rem] shrink-0 text-[11px] font-medium text-gray-400">
                                {Math.min(episodesWatched, anime.episode_count)}/{anime.episode_count}
                            </span>
                        )}
                        <h3 className="font-medium text-gray-300 text-[13px] sm:text-[13.5px] line-clamp-2 leading-[1.3] transition-colors group-hover:text-[var(--anime-title-hover-color)]"
                        >
                            {displayTitle}
                        </h3>
                    </div>
                </Link>
            </div>
        </div>
    );
}

// Optimized prop comparison - shallow comparison is sufficient
const arePropsEqual = (prevProps, nextProps) => {
    if (prevProps.anime.id !== nextProps.anime.id) return false;
    if (prevProps.titleLanguage !== nextProps.titleLanguage) return false;
    if (prevProps.lite !== nextProps.lite) return false;
    if (prevProps.priority !== nextProps.priority) return false;
    if (prevProps.index !== nextProps.index) return false;
    if (prevProps.useBannerAccentTitleHover !== nextProps.useBannerAccentTitleHover) return false;
    if (prevProps.showAiringCountdown !== nextProps.showAiringCountdown) return false;

    const prevEntry = prevProps.userListEntry || prevProps.anime.user_list_status;
    const nextEntry = nextProps.userListEntry || nextProps.anime.user_list_status;
    if (!!prevEntry !== !!nextEntry) return false;
    if (prevEntry?.status !== nextEntry?.status) return false;
    if (prevEntry?.episodes_watched !== nextEntry?.episodes_watched) return false;
    return true;
};

export default React.memo(AnimeCard, arePropsEqual);

// Skeleton loader with AniList-style shimmer effect
export function AnimeCardSkeleton() {
    return (
        <div className="relative h-full flex flex-col">
            {/* Card image placeholder */}
            <div className="aspect-[2/3] bg-dark-200 relative overflow-hidden rounded-lg">
                <div className="absolute inset-0 skeleton-shimmer" />
            </div>

            {/* Card content placeholder */}
            <div className="mt-3 space-y-2 block">
                {/* Title line */}
                <div className="h-3 bg-dark-200 rounded relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-shimmer" />
                </div>
                <div className="h-3 w-2/3 bg-dark-200 rounded relative overflow-hidden">
                    <div className="absolute inset-0 skeleton-shimmer" />
                </div>
            </div>
        </div>
    );
}
