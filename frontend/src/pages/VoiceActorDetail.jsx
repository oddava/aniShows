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
            <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-8 pb-16">
                {/* Back button skeleton */}
                <div className="h-5 w-24 bg-dark-200 rounded mb-8" />

                {/* Header */}
                <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 mb-10">
                    <div className="w-44 h-60 rounded-lg bg-dark-200 mx-auto sm:mx-0 flex-shrink-0" />
                    <div className="flex-1 space-y-3 pt-2">
                        <div className="h-8 w-64 bg-dark-200 rounded mx-auto sm:mx-0" />
                        <div className="h-5 w-40 bg-dark-200 rounded mx-auto sm:mx-0" />
                        <div className="h-4 w-full bg-dark-200 rounded" />
                        <div className="h-4 w-3/4 bg-dark-200 rounded" />
                    </div>
                </div>

                {/* Tabs skeleton */}
                <div className="flex gap-4 mb-6">
                    <div className="h-10 w-32 bg-dark-200 rounded-lg" />
                    <div className="h-10 w-32 bg-dark-200 rounded-lg" />
                </div>

                {/* Grid skeleton */}
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {Array.from({ length: 6 }).map((_, i) => (
                        <div key={i} className="h-28 bg-dark-200 rounded-xl" />
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
    const [activeTab, setActiveTab] = useState('voice_roles');
    const [favoriteState, setFavoriteState] = useState({ isFavorite: false, favoriteCount: 0 });

    const { data: staff, isLoading, error } = useQuery({
        queryKey: ['staff', id],
        queryFn: ({ signal }) => staffApi.getById(id, signal).then(res => res.data),
        staleTime: 1000 * 60 * 10,
    });

    const parsedDescription = useMemo(() => {
        if (!staff?.description) return null;
        return parseMarkdownLinks(staff.description);
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

    const tabs = [
        { id: 'voice_roles', label: 'Voice Roles', count: voiceRoleCount },
        { id: 'production', label: 'Production', count: productionCreditCount },
    ];

    return (
        <>
            <Helmet>
                <title>{staff.name} - aniShows</title>
                <meta name="description" content={`${staff.name} - Voice actor and staff member. ${staff.description?.slice(0, 120) || ''}`} />
            </Helmet>

            <div className="min-h-screen bg-dark">
                <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 sm:pt-8 pb-16">
                    {/* Back navigation */}
                    <button
                        onClick={() => window.history.back()}
                        className="inline-block text-sm font-medium text-gray-400 hover:text-white transition-colors mb-6 sm:mb-8"
                    >
                        Back
                    </button>

                    <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 mb-8 sm:mb-10">
                        <div className="flex-shrink-0 mx-auto sm:mx-0">
                            <div className="w-36 h-48 sm:w-44 sm:h-60 rounded-lg overflow-hidden bg-dark-200">
                                <img
                                    src={getImageUrl(staff.image)}
                                    alt={staff.name}
                                    className="w-full h-full object-cover"
                                />
                            </div>
                            {staff.anilist_id && (
                                <a
                                    href={`https://anilist.co/staff/${staff.anilist_id}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="block text-center mt-3 text-xs font-medium text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                    AniList
                                </a>
                            )}
                        </div>

                        {/* Staff info */}
                        <div className="flex-1 pt-1 pb-4">
                            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                                <div className="text-center sm:text-left">
                                    <h1 className="text-2xl sm:text-3xl font-black text-white mb-1">
                                        {staff.name}
                                    </h1>
                                    {staff.name_native && (
                                        <p className="text-gray-400 text-base sm:text-lg mb-4">
                                            {staff.name_native}
                                        </p>
                                    )}

                                    <div className="flex flex-wrap gap-2 justify-center sm:justify-start mb-5">
                                        {voiceRoleCount > 0 && (
                                            <span className="text-sm font-medium text-gray-400">
                                                {voiceRoleCount} Voice {voiceRoleCount === 1 ? 'Role' : 'Roles'}
                                            </span>
                                        )}
                                        {productionCreditCount > 0 && (
                                            <span className="text-sm font-medium text-gray-400">
                                                {productionCreditCount} Production {productionCreditCount === 1 ? 'Credit' : 'Credits'}
                                            </span>
                                        )}
                                    </div>
                                </div>

                                <div className="flex justify-center sm:justify-end">
                                    <EntityFavoriteButton
                                        isAuthenticated={isAuthenticated}
                                        isFavorite={favoriteState.isFavorite}
                                        favoriteCount={favoriteState.favoriteCount}
                                        isPending={toggleFavoriteMutation.isPending}
                                        onToggle={() => toggleFavoriteMutation.mutate()}
                                        entityLabel="Voice Actor"
                                    />
                                </div>
                            </div>

                            {staff.description && (
                                <div className="max-w-3xl text-sm leading-relaxed text-gray-300">
                                    {parsedDescription}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-2 mb-6 border-b border-white/5 pb-0">
                        {tabs.map((tab) => {
                            const isActive = activeTab === tab.id;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 px-4 py-3 text-sm font-medium transition-all border-b-2 -mb-px ${
                                        isActive
                                            ? 'text-white border-accent font-bold'
                                            : 'text-gray-500 border-transparent hover:text-gray-300'
                                    }`}
                                >
                                    {tab.label}
                                    {tab.count > 0 && (
                                        <span className={`text-xs px-1 font-medium ${
                                            isActive ? 'text-accent' : 'text-gray-600'
                                        }`}>
                                            {tab.count}
                                        </span>
                                    )}
                                </button>
                            );
                        })}
                    </div>

                    {/* Tab content */}
                    {activeTab === 'voice_roles' && (
                        <VoiceRolesSection voiceRoles={staff.voice_roles} />
                    )}
                    {activeTab === 'production' && (
                        <ProductionCreditsSection credits={staff.production_credits} />
                    )}
                </div>
            </div>
        </>
    );
}

function VoiceRolesSection({ voiceRoles }) {
    if (!voiceRoles || voiceRoles.length === 0) {
        return (
            <div className="text-center py-16">
                <p className="text-gray-400 text-sm">No voice roles found.</p>
            </div>
        );
    }

    return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">
            {voiceRoles.map((vr) => (
                <div
                    key={vr.id}
                    className="flex items-center gap-4 py-3 group"
                >
                    {/* Character image */}
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden bg-dark-200 flex-shrink-0">
                        <img
                            src={vr.character?.image || '/placeholder-avatar.png'}
                            alt={vr.character?.name}
                            className="w-full h-full object-cover transition-opacity hover:opacity-80"
                            loading="lazy"
                        />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <Link
                            to={`/character/${vr.character?.id}`}
                            className="block truncate text-sm font-medium text-gray-200 transition-colors hover:text-white"
                        >
                            {vr.character?.name}
                        </Link>
                        <p className="text-xs text-gray-500 mt-0.5">
                            {vr.role}
                        </p>
                        <Link
                            to={vr.anime?.slug ? `/anime/${vr.anime.slug}` : '#'}
                            className="block truncate text-xs text-gray-400 mt-1 transition-colors hover:text-gray-300"
                        >
                            {vr.anime?.title}
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
