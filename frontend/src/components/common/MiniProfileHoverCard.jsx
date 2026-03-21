import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { authApi, favoriteApi, listApi } from '../../api/client';
import FollowButton from '../FollowButton';

const WATCHING_LIMIT = 3;
const FAVORITES_LIMIT = 3;

const normalizeArrayResponse = (payload) => {
    if (Array.isArray(payload)) {
        return payload;
    }
    if (Array.isArray(payload?.results)) {
        return payload.results;
    }
    return [];
};

const formatStat = (value, type = 'int') => {
    const n = Number(value);
    if (!Number.isFinite(n)) return '0';
    if (type === 'float1') return n.toFixed(1);
    return n.toLocaleString();
};

const PosterThumb = ({ anime }) => {
    const poster = anime?.cover_image_small || anime?.cover_image;
    const content = (
        <>
            {poster ? (
                <img
                    src={poster}
                    alt={anime?.title || 'Anime'}
                    className="h-full w-full object-cover"
                    loading="lazy"
                />
            ) : (
                <div className="h-full w-full bg-dark-200" />
            )}
        </>
    );

    if (anime?.slug) {
        return (
            <Link
                to={`/anime/${anime.slug}`}
                className="group/thumb h-12 w-8 overflow-hidden rounded-[4px] border border-gray-700 bg-dark-100 transition-colors hover:border-accent/40"
            >
                {content}
            </Link>
        );
    }

    return (
        <div className="h-12 w-8 overflow-hidden rounded-[4px] border border-gray-700 bg-dark-100">
            {content}
        </div>
    );
};

export default function MiniProfileHoverCard({ user, username, children }) {
    const targetUsername = username || user?.username;
    const [canHover, setCanHover] = useState(false);
    const [isOpen, setIsOpen] = useState(false);
    const closeTimerRef = useRef(null);

    useEffect(() => {
        const media = window.matchMedia('(hover: hover) and (pointer: fine)');
        const onChange = () => setCanHover(media.matches);
        onChange();

        if (media.addEventListener) {
            media.addEventListener('change', onChange);
            return () => media.removeEventListener('change', onChange);
        }

        media.addListener(onChange);
        return () => media.removeListener(onChange);
    }, []);

    useEffect(() => () => {
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
        }
    }, []);

    const openCard = () => {
        if (!canHover || !targetUsername) return;
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
        }
        setIsOpen(true);
    };

    const closeCard = () => {
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
        }
        closeTimerRef.current = window.setTimeout(() => setIsOpen(false), 120);
    };

    const keepOpen = () => {
        if (closeTimerRef.current) {
            window.clearTimeout(closeTimerRef.current);
        }
    };

    const shouldFetch = canHover && isOpen && Boolean(targetUsername);

    const {
        data: profileData,
        isLoading: profileLoading,
        isError: profileError,
    } = useQuery({
        queryKey: ['profile', targetUsername],
        queryFn: async () => {
            const response = await authApi.getByUsername(targetUsername);
            return response.data;
        },
        enabled: shouldFetch,
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: 1,
    });

    const {
        data: watchingItems = [],
        isLoading: watchingLoading,
        isError: watchingError,
    } = useQuery({
        queryKey: ['mini-profile', targetUsername, 'watching'],
        queryFn: async () => {
            const response = await listApi.getAll({
                status: 'Watching',
                username: targetUsername,
                page_size: WATCHING_LIMIT,
            });
            return normalizeArrayResponse(response.data).slice(0, WATCHING_LIMIT);
        },
        enabled: shouldFetch,
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: 1,
    });

    const {
        data: favoriteItems = [],
        isLoading: favoritesLoading,
        isError: favoritesError,
    } = useQuery({
        queryKey: ['mini-profile', targetUsername, 'favorites'],
        queryFn: async () => {
            const response = await favoriteApi.getAll({
                username: targetUsername,
                page: 1,
                page_size: FAVORITES_LIMIT,
            });
            return normalizeArrayResponse(response.data).slice(0, FAVORITES_LIMIT);
        },
        enabled: shouldFetch,
        staleTime: 60 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: 1,
    });

    const initials = useMemo(() => (targetUsername || 'U').slice(0, 2).toUpperCase(), [targetUsername]);
    const loading = profileLoading || watchingLoading || favoritesLoading;
    const allFailed = profileError && watchingError && favoritesError;
    const statsUser = profileData || user || {};

    const stats = [
        { label: 'Total Anime', value: formatStat(statsUser.anime_count, 'int') },
        { label: 'Days Watched', value: formatStat(statsUser.days_watched, 'int') },
        { label: 'Mean Score', value: formatStat(statsUser.mean_score, 'float1') },
        { label: 'Favorites', value: formatStat(statsUser.favorites_count, 'int') },
        { label: 'Reviews', value: formatStat(statsUser.reviews_count, 'int') },
    ];
    const followersCount = formatStat(statsUser.followers_count, 'int');
    const followingCount = formatStat(statsUser.following_count, 'int');

    if (!targetUsername) {
        return children;
    }

    return (
        <div className="relative inline-flex" onMouseEnter={openCard} onMouseLeave={closeCard}>
            {children}

            {canHover && isOpen && (
                <div
                    className="absolute left-0 top-full z-50 mt-2.5 w-72 rounded-xl border border-gray-700 bg-dark-100 p-3 shadow-2xl"
                    onMouseEnter={keepOpen}
                    onMouseLeave={closeCard}
                >
                    <div className="mb-2 flex items-start justify-between gap-2">
                        <div className="flex items-center gap-2">
                            {user?.avatar ? (
                                <img
                                    src={user.avatar}
                                    alt={targetUsername}
                                    className="h-8 w-8 rounded-full object-cover border border-gray-700"
                                    loading="lazy"
                                />
                            ) : (
                                <div className="flex h-8 w-8 items-center justify-center rounded-full border border-gray-700 bg-dark-200 text-[10px] font-bold text-gray-200">
                                    {initials}
                                </div>
                            )}
                            <Link to={`/u/${targetUsername}`} className="text-xs font-bold text-gray-200 hover:text-white">
                                {targetUsername}
                            </Link>
                        </div>
                        <FollowButton
                            username={targetUsername}
                            initialIsFollowing={Boolean(profileData?.is_following ?? user?.is_following)}
                            initialIsFollower={Boolean(profileData?.is_follower ?? user?.is_follower)}
                            variant="compact"
                            tone="dark"
                            showLabelOnMobile
                            className="min-w-[86px] rounded-full px-3.5 py-1.5 text-xs font-semibold"
                        />
                    </div>
                    <p className="mb-2 text-[10px] font-medium text-gray-500">
                        <span className="text-gray-300">{followersCount}</span> Followers
                        <span className="px-1.5 text-gray-600">•</span>
                        <span className="text-gray-300">{followingCount}</span> Following
                    </p>

                    {loading ? (
                        <div className="space-y-2">
                            <div className="h-12 rounded-md border border-gray-700 bg-dark-200/70" />
                            <div className="h-16 rounded-md border border-gray-700 bg-dark-200/70" />
                            <div className="h-16 rounded-md border border-gray-700 bg-dark-200/70" />
                        </div>
                    ) : allFailed ? (
                        <p className="text-xs text-gray-500">Could not load profile preview.</p>
                    ) : (
                        <div className="space-y-2.5">
                            <section>
                                <div className="grid grid-cols-5 gap-1 rounded-md border border-gray-700 bg-dark-200/40 p-2">
                                    {stats.map((stat) => (
                                        <div key={stat.label} className="text-center">
                                            <p className="text-[11px] font-bold leading-none text-gray-200">{stat.value}</p>
                                            <p className="mt-0.5 text-[8px] font-semibold uppercase tracking-[0.06em] text-gray-500">
                                                {stat.label}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            </section>

                            <section>
                                <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">Watching</p>
                                {watchingItems.length > 0 ? (
                                    <div className="flex items-center gap-1.5">
                                        {watchingItems.map((item) => (
                                            <PosterThumb
                                                key={`watching-${item.id}`}
                                                anime={item.anime}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-500">No active watching list.</p>
                                )}
                            </section>

                            <section>
                                <p className="mb-1 text-[9px] font-bold uppercase tracking-[0.1em] text-gray-500">Favorites</p>
                                {favoriteItems.length > 0 ? (
                                    <div className="flex items-center gap-1.5">
                                        {favoriteItems.map((item) => (
                                            <PosterThumb
                                                key={`favorite-${item.id}`}
                                                anime={item.anime}
                                            />
                                        ))}
                                    </div>
                                ) : (
                                    <p className="text-xs text-gray-500">No favorites yet.</p>
                                )}
                            </section>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
