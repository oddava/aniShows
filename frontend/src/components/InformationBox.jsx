import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Tv, Hash, Clock, Calendar, BookOpen, Building2, Users, Bell, ExternalLink } from 'lucide-react';
import {
    formatAiringTime,
    formatDate,
    formatRelativeTime,
} from '../utils/dateUtils';
import {
    formatCompactCount,
    getStatusDistributionTotal,
    normalizeStatusDistribution,
} from '../utils/statusDistribution';

const InfoRow = ({ icon: Icon, label, value }) => (
    <div className="flex items-start justify-between gap-4 py-1 min-w-0">
        <div className="flex items-center gap-2 pt-1 shrink-0">
            <Icon className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-gray-300 text-xs font-semibold ">
                {label}
            </p>
        </div>
        <div className="text-gray-200 font-bold text-sm text-right leading-relaxed break-words min-w-0 max-w-[60%]">
            {value}
        </div>
    </div>
);

const getBrowseFilterHref = (key, value) => {
    const params = new URLSearchParams({ [key]: value });
    return `/browse?${params.toString()}`;
};


const TAG_PREVIEW_COUNT = 12;

export default function InformationBox({ anime, className, accentColor }) {
    const [showAllTags, setShowAllTags] = useState(false);
    const tagCount = anime?.tags?.length || 0;
    const visibleTags = showAllTags ? anime?.tags || [] : (anime?.tags || []).slice(0, TAG_PREVIEW_COUNT);
    const totalMembers = getStatusDistributionTotal(
        normalizeStatusDistribution(anime?.status_distribution)
    );

    const formatDateRange = () => {
        if (!anime.release_date) return 'Unknown';
        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        const startStr = formatDate(anime.release_date, options);

        if (anime.status === 'Airing' && !anime.end_date) {
            return (
                <div className="flex flex-col items-end leading-tight">
                    <span>{startStr}</span>
                    <span className="text-xs font-semibold text-gray-500 my-1">to</span>
                    <span className="text-gray-200">Present</span>
                </div>
            );
        }

        if (anime.end_date) {
            const endStr = formatDate(anime.end_date, options);
            if (startStr === endStr) return startStr;
            return (
                <div className="flex flex-col items-end leading-tight">
                    <span>{startStr}</span>
                    <span className="text-xs font-semibold text-gray-400 my-1">to</span>
                    <span>{endStr}</span>
                </div>
            );
        }

        return startStr;
    };

    return (
        <div className={`flex flex-col gap-6 bg-dark-100/50 p-6 rounded-2xl border border-gray-800 min-w-0 overflow-hidden ${className}`}>
            <h3 className="text-sm font-semibold text-gray-300">
                Information
            </h3>
            <div className="space-y-4">
                <InfoRow icon={Tv} label="Type" value={anime.anime_type} />
                <InfoRow icon={Hash} label="Episodes" value={anime.episode_count || 'Unknown'} />

                {anime.duration_minutes > 0 && (
                    <InfoRow icon={Clock} label="Duration" value={`${anime.duration_minutes} min`} />
                )}

                {anime.release_date && (
                    <InfoRow icon={Calendar} label="Aired" value={formatDateRange()} />
                )}

                {(anime.season || anime.season_year) && (
                    <InfoRow
                        icon={Calendar}
                        label="Season"
                        value={`${anime.season || ''} ${anime.season_year || ''}`.trim()}
                    />
                )}

                {anime.source_material && (
                    <InfoRow icon={BookOpen} label="Source" value={anime.source_material} />
                )}

                {anime.studio && (
                    <InfoRow icon={Building2} label="Studio" value={anime.studio.name} />
                )}

                <InfoRow icon={Users} label="Members" value={formatCompactCount(totalMembers)} />

                {anime.status !== 'Finished' && anime.next_airing_date && (
                    <div className="pt-4 mt-4 border-t border-white/10">
                        <div
                            className="p-4 rounded-xl border"
                            style={{
                                backgroundColor: 'var(--signature-soft)',
                                borderColor: 'var(--signature-line)'
                            }}
                        >
                            <div className="flex items-center gap-2 mb-3">
                                <Bell
                                    className="w-4 h-4"
                                    style={{
                                        color: 'var(--signature)'
                                    }}
                                />
                                <span
                                    className="text-xs font-semibold "
                                    style={{
                                        color: 'var(--signature)'
                                    }}
                                >
                                    Next Episode
                                </span>
                            </div>
                            <div className="space-y-1">
                                <p className="text-gray-200 font-bold text-lg">
                                    Episode {anime.next_airing_episode ?? 'TBA'}
                                </p>
                                <p
                                    className="text-sm font-semibold"
                                    style={{
                                        color: 'var(--signature)'
                                    }}
                                >
                                    {formatRelativeTime(anime.next_airing_date)}
                                </p>
                                <p className="text-gray-400 text-xs">
                                    {formatAiringTime(anime.next_airing_date)}
                                </p>
                            </div>
                        </div>
                    </div>
                )}

                {anime.genres && anime.genres.length > 0 && (
                    <div className="pt-6 mt-8 border-t border-white/5">
                        <p className="text-sm font-semibold text-gray-300 mb-3">Genres</p>
                        <div className="flex flex-wrap gap-2">
                            {anime.genres.map((genre) => (
                                <Link
                                    key={genre.id}
                                    to={getBrowseFilterHref('genre', genre.slug)}
                                    className="inline-flex min-h-9 items-center px-3 text-xs font-semibold rounded-lg transition-colors bg-white/[0.05] text-gray-200 hover:bg-white/[0.1] hover:text-white"
                                >
                                    {genre.name}
                                </Link>
                            ))}
                        </div>
                    </div>
                )}

                {anime.tags && anime.tags.length > 0 && (
                    <div className="pt-5 mt-5 border-t border-white/5">
                        <p className="text-sm font-semibold text-gray-300 mb-3">Tags</p>
                        <div>
                            <div id={`tags-${anime.id}`} className="flex flex-wrap gap-2">
                                {visibleTags.map((tag) => (
                                    <Link
                                        key={tag}
                                        to={getBrowseFilterHref('tags', tag)}
                                        className="inline-flex min-h-9 items-center px-3 text-xs font-semibold rounded-lg transition-colors bg-white/[0.05] text-gray-200 hover:bg-white/[0.1] hover:text-white"
                                    >
                                        {tag}
                                    </Link>
                                ))}
                            </div>
                            {tagCount > TAG_PREVIEW_COUNT && (
                                <button
                                    type="button"
                                    onClick={() => setShowAllTags((value) => !value)}
                                    aria-expanded={showAllTags}
                                    aria-controls={`tags-${anime.id}`}
                                    className="mt-3 -ml-1 rounded-md px-1 py-0.5 text-xs font-semibold text-gray-400 hover:text-white transition-colors"
                                >
                                    {showAllTags ? 'Show less' : `Show all ${tagCount}`}
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {anime.external_links && anime.external_links.length > 0 && (
                    <div className="pt-5 mt-5 border-t border-white/5">
                        <p className="text-sm font-semibold text-gray-300 mb-3">External Links</p>
                        <div className="grid grid-cols-2 gap-2">
                            {anime.external_links.map((link, i) => {
                                const isAccentLink = ['Official Site', 'Netflix', 'Crunchyroll', 'Twitter'].includes(link.site);
                                return (
                                    <a
                                        key={i}
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`min-h-10 px-3 text-xs font-semibold rounded-lg transition-colors flex items-center justify-between gap-2 ${
                                            isAccentLink
                                                ? 'bg-white/[0.07] text-gray-100 hover:bg-white/[0.12]'
                                                : 'bg-white/[0.03] text-gray-400 hover:bg-white/[0.08] hover:text-white'
                                        }`}
                                    >
                                        <span className="truncate">{link.site}</span>
                                        <ExternalLink className="w-3 h-3 shrink-0 opacity-60" />
                                    </a>
                                );
                            })}
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}
