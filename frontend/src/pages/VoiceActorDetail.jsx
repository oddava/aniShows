import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { useEffect, useMemo, useState } from 'react';
import { Helmet } from 'react-helmet-async';
import { staffApi, staffFavoriteApi } from '../api/client';
import AnimeMediaImage from '../components/common/AnimeMediaImage';
import EntityFavoriteButton from '../components/common/EntityFavoriteButton';
import { useAuth } from '../context/AuthContext';

// Parse markdown-style links [text](url) into React elements
function parseMarkdownLinks(text) {
    if (!text) return null;
    const parts = text.split(/(\[.*?\]\(.*?\))/g);
    return parts.map((part, index) => {
        const match = part.match(/\[(.*?)\]\((.*?)\)/);
        if (match) {
            const [, linkText, url] = match;
            return (
                <a
                    key={index}
                    href={url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline transition-colors"
                    onClick={(e) => e.stopPropagation()}
                >
                    {linkText}
                </a>
            );
        }
        return <span key={index}>{part.replace(/<[^>]*>/g, '')}</span>;
    });
}

function StaffDetailSkeleton() {
    return (
        <div className="min-h-screen bg-dark animate-pulse">
            <div className="mx-auto max-w-6xl px-4 pb-16 pt-8 sm:px-6">
                <div className="mb-8 h-5 w-24 rounded bg-dark-200" />
                <div className="mb-10 grid grid-cols-[112px_1fr] sm:grid-cols-[176px_1fr] gap-x-4 sm:gap-x-8 gap-y-6">
                    <div className="col-start-1 row-start-1 sm:row-span-2 h-40 w-28 sm:h-60 sm:w-44 rounded-lg bg-dark-200 mx-auto sm:mx-0" />
                    <div className="col-start-2 row-start-1 flex flex-row items-start justify-between gap-3 sm:gap-4 pt-2">
                        <div className="space-y-3 flex-1 min-w-0">
                            <div className="h-6 sm:h-8 w-full max-w-[16rem] rounded bg-dark-200" />
                            <div className="h-4 sm:h-5 w-24 sm:w-40 rounded bg-dark-200" />
                            <div className="h-4 w-20 sm:w-32 rounded bg-dark-200 mt-4" />
                        </div>
                        <div className="h-9 sm:h-10 w-16 sm:w-20 rounded-xl bg-dark-200 flex-shrink-0" />
                    </div>
                    <div className="col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-2 space-y-3">
                        <div className="h-4 w-full rounded bg-dark-200" />
                        <div className="h-4 w-5/6 rounded bg-dark-200" />
                    </div>
                </div>
                <div className="grid grid-cols-1 gap-x-6 gap-y-4 sm:grid-cols-2 lg:grid-cols-3">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-20 bg-dark-200 rounded-lg" />
                    ))}
                </div>
            </div>
        </div>
    );
}

export default function VoiceActorDetail() {
    const { id } = useParams();
    const { isAuthenticated, user } = useAuth();
    const queryClient = useQueryClient();
    const [favoriteState, setFavoriteState] = useState({ isFavorite: false, favoriteCount: 0 });

    const { data: staff, isLoading, error } = useQuery({
        queryKey: ['staff', id],
        queryFn: ({ signal }) => staffApi.getById(id, signal).then(res => res.data),
        staleTime: 1000 * 60 * 10,
    });

    const parsedDescription = useMemo(() => {
        if (!staff?.description) return null;
        return staff.description.split('\n').filter(p => !!p.trim()).map((para, i) => (
            <p key={i} className="mb-4 last:mb-0">
                {parseMarkdownLinks(para)}
            </p>
        ));
    }, [staff?.description]);

    useEffect(() => {
        setFavoriteState({
            isFavorite: Boolean(staff?.is_favorite),
            favoriteCount: staff?.favorite_count || 0,
        });
    }, [staff?.favorite_count, staff?.is_favorite]);



    const toggleFavoriteMutation = useMutation({
        mutationFn: () => staffFavoriteApi.toggle(staff.id),
        onSuccess: (response) => {
            setFavoriteState({
                isFavorite: response.data.is_favorite,
                favoriteCount: response.data.favorite_count ?? 0,
            });
            queryClient.invalidateQueries({ queryKey: ['staff', id] });
            if (user?.username) {
                queryClient.invalidateQueries({ queryKey: ['staff-favorites', user.username] });
            }
        },
    });

    const voiceRoleCount = staff?.voice_roles?.length || 0;
    const productionCreditCount = staff?.production_credits?.length || 0;

    if (isLoading) return <StaffDetailSkeleton />;

    if (error || !staff) {
        return (
            <div className="min-h-screen bg-dark flex items-center justify-center">
                <div className="text-center">
                    <h2 className="text-xl font-bold text-white mb-2">Staff Not Found</h2>
                    <p className="text-gray-400 mb-6">The staff member you're looking for doesn't exist.</p>
                    <Link to="/" className="text-accent hover:text-accent/80 font-medium transition-colors">
                        Go Home
                    </Link>
                </div>
            </div>
        );
    }

    const getImageUrl = (url) => url || '/placeholder-avatar.png';

    const appearanceCount = voiceRoleCount + productionCreditCount;

    return (
        <>
            <Helmet>
                <title>{staff.name} - aniShows</title>
                <meta name="description" content={`${staff.name} - Voice actor and staff member. ${staff.description?.slice(0, 120) || ''}`} />
            </Helmet>

            <div className="min-h-screen bg-dark">
                <div className="mx-auto max-w-6xl px-4 pb-16 pt-6 sm:px-6 sm:pt-8">
                    {/* Back navigation */}
                    <button
                        type="button"
                        onClick={() => window.history.back()}
                        className="mb-6 inline-block text-sm font-medium text-gray-400 transition-colors hover:text-white sm:mb-8"
                    >
                        Back
                    </button>

                    <div className="mb-8 grid grid-cols-[112px_1fr] sm:grid-cols-[176px_1fr] gap-x-4 sm:gap-x-8 gap-y-6 sm:mb-10">
                        <div className="col-start-1 row-start-1 sm:row-span-2 mx-auto sm:mx-0">
                            <div className="h-40 w-28 sm:h-60 sm:w-44 overflow-hidden rounded-lg bg-dark-200">
                                <img
                                    src={getImageUrl(staff.image)}
                                    alt={staff.name}
                                    className="h-full w-full object-cover"
                                />
                            </div>
                            {staff.anilist_id && (
                                <a
                                    href={`https://anilist.co/staff/${staff.anilist_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="mt-3 block text-center text-xs font-medium text-gray-500 transition-colors hover:text-gray-300"
                                >
                                    AniList
                                </a>
                            )}
                        </div>

                        <div className="col-start-2 row-start-1 flex flex-row items-start justify-between gap-3 sm:gap-4 pt-1">
                            <div className="text-left min-w-0">
                                <h1 className="mb-1 text-xl font-black text-white sm:text-3xl break-words">
                                    {staff.name}
                                </h1>
                                {staff.name_native && (
                                    <p className="mb-3 text-sm text-gray-400 sm:text-lg break-words">
                                        {staff.name_native}
                                    </p>
                                )}

                                {appearanceCount > 0 && (
                                    <div className="mb-4">
                                        <span className="text-xs sm:text-sm font-medium text-gray-400">
                                            {appearanceCount} {appearanceCount === 1 ? 'Appearance' : 'Appearances'}
                                        </span>
                                    </div>
                                )}
                            </div>

                            <div className="flex flex-shrink-0">
                                <EntityFavoriteButton
                                    isAuthenticated={isAuthenticated}
                                    isFavorite={favoriteState.isFavorite}
                                    favoriteCount={favoriteState.favoriteCount}
                                    isPending={toggleFavoriteMutation.isPending}
                                    onToggle={() => toggleFavoriteMutation.mutate()}
                                    entityLabel="Staff Member"
                                />
                            </div>
                        </div>

                        {staff.description && (
                            <div className="col-span-2 col-start-1 row-start-2 sm:col-span-1 sm:col-start-2 sm:row-start-2 max-w-3xl text-sm leading-relaxed text-gray-200 font-medium">
                                {parsedDescription}
                            </div>
                        )}
                    </div>

                    <section>
                        <div className="mb-5">
                            <h2 className="text-lg font-medium text-white sm:text-xl">Voice Roles</h2>
                        </div>
                        <VoiceRolesSection voiceRoles={staff.voice_roles} />
                    </section>

                    {productionCreditCount > 0 && (
                        <section className="mt-10">
                            <div className="mb-5">
                                <h2 className="text-lg font-medium text-white sm:text-xl">Production Credits</h2>
                            </div>
                            <ProductionCreditsSection credits={staff.production_credits} />
                        </section>
                    )}
                </div>
            </div>
        </>
    );
}

function VoiceRolesSection({ voiceRoles }) {
    if (!voiceRoles || voiceRoles.length === 0) {
        return null;
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            {voiceRoles.map((vr) => (
                <div
                    key={vr.id}
                    className="group flex gap-4 py-3 transition-colors"
                >
                    <div className="relative h-20 w-14 flex-shrink-0 overflow-hidden rounded bg-dark-200">
                        <Link to={vr.anime?.slug ? `/anime/${vr.anime.slug}` : '#'} className="block h-full w-full">
                            <AnimeMediaImage
                                anime={vr.anime}
                                kind="cover"
                                size="small"
                                alt={vr.anime?.title}
                                className="h-full w-full object-cover transition-opacity hover:opacity-80"
                                loading="lazy"
                            />
                        </Link>
                    </div>

                    <div className="min-w-0 flex-1 flex flex-col justify-center">
                        <Link
                            to={vr.anime?.slug ? `/anime/${vr.anime.slug}` : '#'}
                            className="truncate text-sm font-medium text-gray-200 transition-colors hover:text-white"
                        >
                            {vr.anime?.title}
                        </Link>
                        <p className="mt-0.5 text-xs text-gray-500">
                            {vr.role}
                        </p>
                        <Link
                            to={`/character/${vr.character?.id}`}
                            className="mt-1.5 block truncate text-xs text-gray-400 transition-colors hover:text-gray-300"
                        >
                            {vr.character?.name}
                        </Link>
                    </div>
                </div>
            ))}
        </div>
    );
}

function ProductionCreditsSection({ credits }) {
    if (!credits || credits.length === 0) {
        return (
            <div className="text-center py-16">
                <p className="text-gray-400 text-sm">No production credits found.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            {credits.map((credit) => (
                <div
                    key={credit.id}
                    className="flex items-center gap-4 py-3 group"
                >
                    {/* Anime cover */}
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden bg-dark-200 flex-shrink-0">
                        <Link to={credit.anime?.slug ? `/anime/${credit.anime.slug}` : '#'}>
                            <AnimeMediaImage
                                anime={credit.anime}
                                kind="cover"
                                size="small"
                                alt={credit.anime?.title}
                                className="w-full h-full object-cover transition-opacity hover:opacity-80"
                                loading="lazy"
                            />
                        </Link>
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <Link
                            to={credit.anime?.slug ? `/anime/${credit.anime.slug}` : '#'}
                            className="block truncate text-sm font-medium text-gray-200 transition-colors hover:text-white"
                        >
                            {credit.anime?.title}
                        </Link>
                        <p className="text-xs text-gray-500 mt-1">
                            {credit.role}
                        </p>
                    </div>
                </div>
            ))}
        </div>
    );
}
