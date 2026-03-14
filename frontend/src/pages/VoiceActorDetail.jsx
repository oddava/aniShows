import { useQuery } from '@tanstack/react-query';
import { useParams, Link } from 'react-router-dom';
import { Mic, Film, Users, ArrowLeft, ExternalLink } from 'lucide-react';
import { useState, useMemo } from 'react';
import { Helmet } from 'react-helmet-async';
import { staffApi } from '../api/client';

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
                    <div className="w-36 h-48 sm:w-44 sm:h-60 rounded-2xl bg-dark-200 mx-auto sm:mx-0 flex-shrink-0" />
                    <div className="flex-1 space-y-3 pt-2">
                        <div className="h-8 w-64 bg-dark-200 rounded mx-auto sm:mx-0" />
                        <div className="h-5 w-40 bg-dark-200 rounded mx-auto sm:mx-0" />
                        <div className="h-4 w-full bg-dark-200 rounded" />
                        <div className="h-4 w-3/4 bg-dark-200 rounded" />
                        <div className="h-4 w-1/2 bg-dark-200 rounded" />
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
    const [activeTab, setActiveTab] = useState('voice_roles');

    const { data: staff, isLoading, error } = useQuery({
        queryKey: ['staff', id],
        queryFn: ({ signal }) => staffApi.getById(id, signal).then(res => res.data),
        staleTime: 1000 * 60 * 10,
    });

    const parsedDescription = useMemo(() => {
        if (!staff?.description) return null;
        return parseMarkdownLinks(staff.description);
    }, [staff?.description]);

    const [descExpanded, setDescExpanded] = useState(false);

    const voiceRoleCount = staff?.voice_roles?.length || 0;
    const productionCreditCount = staff?.production_credits?.length || 0;

    if (isLoading) return <StaffDetailSkeleton />;

    if (error || !staff) {
        return (
            <div className="min-h-screen bg-dark flex items-center justify-center">
                <div className="text-center">
                    <Users className="w-16 h-16 text-gray-700 mx-auto mb-4" />
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
        { id: 'voice_roles', label: 'Voice Roles', icon: Mic, count: voiceRoleCount },
        { id: 'production', label: 'Production', icon: Film, count: productionCreditCount },
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
                        className="flex items-center gap-1.5 text-sm text-gray-400 hover:text-white transition-colors mb-6 sm:mb-8"
                    >
                        <ArrowLeft className="w-4 h-4" />
                        Back
                    </button>

                    {/* Header section */}
                    <div className="flex flex-col sm:flex-row gap-6 sm:gap-8 mb-8 sm:mb-10">
                        {/* Staff image */}
                        <div className="flex-shrink-0 mx-auto sm:mx-0">
                            <div className="w-36 h-48 sm:w-44 sm:h-60 rounded-2xl overflow-hidden border-2 border-gray-800 shadow-2xl">
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
                                    className="flex items-center justify-center gap-1.5 mt-3 text-xs text-gray-500 hover:text-gray-300 transition-colors"
                                >
                                    <ExternalLink className="w-3 h-3" />
                                    AniList
                                </a>
                            )}
                        </div>

                        {/* Staff info */}
                        <div className="flex-1 text-center sm:text-left pt-1">
                            <h1 className="text-2xl sm:text-3xl font-black text-white mb-1">
                                {staff.name}
                            </h1>
                            {staff.name_native && (
                                <p className="text-gray-400 text-base sm:text-lg mb-4">
                                    {staff.name_native}
                                </p>
                            )}

                            {/* Stats badges */}
                            <div className="flex flex-wrap gap-2 justify-center sm:justify-start mb-5">
                                {voiceRoleCount > 0 && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full bg-purple-500/15 text-purple-400">
                                        <Mic className="w-3 h-3" />
                                        {voiceRoleCount} Voice {voiceRoleCount === 1 ? 'Role' : 'Roles'}
                                    </span>
                                )}
                                {productionCreditCount > 0 && (
                                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-bold rounded-full bg-blue-500/15 text-blue-400">
                                        <Film className="w-3 h-3" />
                                        {productionCreditCount} Production {productionCreditCount === 1 ? 'Credit' : 'Credits'}
                                    </span>
                                )}
                            </div>

                            {/* Description */}
                            {staff.description && (
                                <div className="relative">
                                    <div className={`text-gray-300 text-sm leading-relaxed max-w-3xl transition-all duration-300 ${!descExpanded ? 'line-clamp-4' : ''}`}>
                                        {parsedDescription}
                                    </div>
                                    {staff.description.length > 300 && (
                                        <>
                                            {!descExpanded && (
                                                <div className="absolute bottom-0 left-0 right-0 h-10 bg-dark/80 pointer-events-none" />
                                            )}
                                            <button
                                                onClick={() => setDescExpanded(!descExpanded)}
                                                className="mt-1 text-sm font-bold text-accent hover:text-accent/80 transition-colors"
                                            >
                                                {descExpanded ? 'Show Less' : 'Read More'}
                                            </button>
                                        </>
                                    )}
                                </div>
                            )}
                        </div>
                    </div>

                    {/* Tabs */}
                    <div className="flex gap-2 mb-6 border-b border-white/5 pb-0">
                        {tabs.map((tab) => {
                            const isActive = activeTab === tab.id;
                            const Icon = tab.icon;
                            return (
                                <button
                                    key={tab.id}
                                    onClick={() => setActiveTab(tab.id)}
                                    className={`flex items-center gap-2 px-4 py-3 text-sm font-bold transition-all border-b-2 -mb-px ${
                                        isActive
                                            ? 'text-white border-accent'
                                            : 'text-gray-500 border-transparent hover:text-gray-300'
                                    }`}
                                >
                                    <Icon className="w-4 h-4" />
                                    {tab.label}
                                    {tab.count > 0 && (
                                        <span className={`text-xs px-1.5 py-0.5 rounded-full ${
                                            isActive ? 'bg-accent/20 text-accent' : 'bg-white/5 text-gray-500'
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
            <div className="text-center py-16 animate-tab-content">
                <Mic className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No voice roles found.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3 animate-tab-content">
            {voiceRoles.map((vr) => (
                <Link
                    key={vr.id}
                    to={vr.anime?.slug ? `/anime/${vr.anime.slug}` : '#'}
                    className="flex items-center gap-4 p-3 sm:p-4 bg-dark-100/40 rounded-xl border border-white/5 hover:border-gray-700 hover:bg-dark-100/60 transition-all group"
                >
                    {/* Character image */}
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden border border-gray-800 flex-shrink-0">
                        <img
                            src={vr.character?.image || '/placeholder-avatar.png'}
                            alt={vr.character?.name}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-white text-sm sm:text-base truncate group-hover:text-accent transition-colors">
                            {vr.character?.name}
                        </h3>
                        <p className="text-xs text-gray-500 mt-0.5">
                            <span className={`inline-block px-1.5 py-0.5 rounded text-[10px] font-bold uppercase mr-2 ${
                                vr.role === 'MAIN'
                                    ? 'bg-purple-500/20 text-purple-400'
                                    : vr.role === 'SUPPORTING'
                                        ? 'bg-blue-500/20 text-blue-400'
                                        : 'bg-white/10 text-gray-400'
                            }`}>
                                {vr.role}
                            </span>
                        </p>
                    </div>

                    {/* Anime cover */}
                    <div className="flex items-center gap-3 flex-shrink-0">
                        <div className="hidden sm:block text-right">
                            <p className="text-sm text-gray-300 font-medium truncate max-w-[200px]">
                                {vr.anime?.title}
                            </p>
                        </div>
                        <div className="w-10 h-14 sm:w-12 sm:h-16 rounded-lg overflow-hidden border border-gray-800 flex-shrink-0">
                            <img
                                src={vr.anime?.cover_image_small || '/placeholder-cover.png'}
                                alt={vr.anime?.title}
                                className="w-full h-full object-cover"
                                loading="lazy"
                            />
                        </div>
                    </div>
                </Link>
            ))}
        </div>
    );
}

function ProductionCreditsSection({ credits }) {
    if (!credits || credits.length === 0) {
        return (
            <div className="text-center py-16 animate-tab-content">
                <Film className="w-12 h-12 text-gray-700 mx-auto mb-3" />
                <p className="text-gray-400 text-sm">No production credits found.</p>
            </div>
        );
    }

    return (
        <div className="space-y-3 animate-tab-content">
            {credits.map((credit) => (
                <Link
                    key={credit.id}
                    to={credit.anime?.slug ? `/anime/${credit.anime.slug}` : '#'}
                    className="flex items-center gap-4 p-3 sm:p-4 bg-dark-100/40 rounded-xl border border-white/5 hover:border-gray-700 hover:bg-dark-100/60 transition-all group"
                >
                    {/* Anime cover */}
                    <div className="w-14 h-14 sm:w-16 sm:h-16 rounded-lg overflow-hidden border border-gray-800 flex-shrink-0">
                        <img
                            src={credit.anime?.cover_image_small || '/placeholder-cover.png'}
                            alt={credit.anime?.title}
                            className="w-full h-full object-cover"
                            loading="lazy"
                        />
                    </div>

                    {/* Info */}
                    <div className="flex-1 min-w-0">
                        <h3 className="font-bold text-white text-sm sm:text-base truncate group-hover:text-accent transition-colors">
                            {credit.anime?.title}
                        </h3>
                        <p className="text-xs text-gray-500 mt-1">
                            <span className="inline-block px-2 py-0.5 rounded bg-white/5 text-gray-400 text-[11px] font-medium">
                                {credit.role}
                            </span>
                        </p>
                    </div>
                </Link>
            ))}
        </div>
    );
}
