import { Link } from 'react-router-dom';
import { Tv, Hash, Clock, Calendar, BookOpen, Building2, Users, Bell, ExternalLink } from 'lucide-react';
import { formatRelativeTime, formatAiringTime, isWithin24Hours } from '../utils/dateUtils';

const InfoRow = ({ icon: Icon, label, value }) => (
    <div className="flex items-start justify-between gap-4 py-1 min-w-0">
        <div className="flex items-center gap-2 pt-1 shrink-0">
            <Icon className="w-3.5 h-3.5 text-gray-400" />
            <p className="text-gray-300 text-[10px] font-black uppercase tracking-wider">
                {label}
            </p>
        </div>
        <div className="text-gray-200 font-bold text-sm text-right leading-relaxed break-words min-w-0 max-w-[60%]">
            {value}
        </div>
    </div>
);

export default function InformationBox({ anime, className, accentColor }) {
    const formatDateRange = () => {
        if (!anime.release_date) return 'Unknown';
        const options = { month: 'short', day: 'numeric', year: 'numeric' };
        const startStr = new Date(anime.release_date).toLocaleDateString('en-US', options);

        if (anime.status === 'Airing' && !anime.end_date) {
            return (
                <div className="flex flex-col items-end leading-tight">
                    <span>{startStr}</span>
                    <span className="text-[10px] font-black text-gray-500 uppercase tracking-widest my-1">to</span>
                    <span style={{ color: accentColor || '#75698d' }}>Present</span>
                </div>
            );
        }

        if (anime.end_date) {
            const endStr = new Date(anime.end_date).toLocaleDateString('en-US', options);
            if (startStr === endStr) return startStr;
            return (
                <div className="flex flex-col items-end leading-tight">
                    <span>{startStr}</span>
                    <span className="text-[10px] font-black text-gray-400 uppercase tracking-widest my-1">to</span>
                    <span>{endStr}</span>
                </div>
            );
        }

        return startStr;
    };

    return (
        <div className={`flex flex-col gap-6 bg-dark-100/50 p-6 rounded-2xl border border-gray-800 min-w-0 overflow-hidden ${className}`}>
            <h3 className="text-xs font-bold text-gray-400 uppercase tracking-[0.16em]">
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

                {anime.member_count > 0 && (
                    <InfoRow icon={Users} label="Members" value={anime.member_count.toLocaleString()} />
                )}

                {anime.status === 'Airing' && anime.next_airing_date && (
                    <div className="pt-4 mt-4 border-t border-white/10">
                        <div
                            className="p-4 rounded-xl border"
                            style={{
                                backgroundColor: isWithin24Hours(anime.next_airing_date)
                                    ? 'rgba(34, 197, 94, 0.1)'
                                    : (accentColor ? `${accentColor}15` : 'rgba(117, 105, 141, 0.1)'),
                                borderColor: isWithin24Hours(anime.next_airing_date)
                                    ? 'rgba(34, 197, 94, 0.3)'
                                    : (accentColor ? `${accentColor}30` : 'rgba(117, 105, 141, 0.2)')
                            }}
                        >
                            <div className="flex items-center gap-2 mb-3">
                                <Bell
                                    className="w-4 h-4"
                                    style={{
                                        color: isWithin24Hours(anime.next_airing_date)
                                            ? '#22c55e'
                                            : (accentColor || '#75698d')
                                    }}
                                />
                                <span
                                    className="text-[10px] font-black uppercase tracking-widest"
                                    style={{
                                        color: isWithin24Hours(anime.next_airing_date)
                                            ? '#22c55e'
                                            : (accentColor || '#75698d')
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
                                        color: isWithin24Hours(anime.next_airing_date)
                                            ? '#22c55e'
                                            : (accentColor || '#75698d')
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
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em] mb-3">Genres</p>
                        <div className="flex flex-wrap gap-2">
                            {anime.genres.map((genre) => (
                                <Link
                                    key={genre.id}
                                    to={`/browse?genre=${genre.slug}`}
                                    className="px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border"
                                    style={{
                                        color: accentColor || '#75698d',
                                        borderColor: accentColor ? `${accentColor}80` : 'rgba(117,105,141,0.5)',
                                        backgroundColor: accentColor ? `${accentColor}10` : 'rgba(117,105,141,0.05)',
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.backgroundColor = accentColor || '#75698d';
                                        e.currentTarget.style.color = 'white';
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.backgroundColor = accentColor ? `${accentColor}10` : 'rgba(117,105,141,0.05)';
                                        e.currentTarget.style.color = accentColor || '#75698d';
                                    }}
                                >
                                    {genre.name}
                                </Link>
                            ))}
                        </div>
                    </div>
                )}

                {anime.external_links && anime.external_links.length > 0 && (
                    <div className="pt-5 mt-5 border-t border-white/5">
                        <p className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em] mb-3">External Links</p>
                        <div className="grid grid-cols-2 gap-2">
                            {anime.external_links.map((link, i) => {
                                const isAccentLink = ['Official Site', 'Netflix', 'Crunchyroll', 'Twitter'].includes(link.site);
                                return (
                                    <a
                                        key={i}
                                        href={link.url}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className={`px-3 py-2 text-[11px] font-bold rounded-lg transition-all flex items-center justify-between gap-2 border ${
                                            isAccentLink
                                                ? 'bg-transparent hover:text-white'
                                                : 'bg-dark-200 hover:bg-white text-gray-400 hover:text-black border-gray-700/50 hover:border-white'
                                        }`}
                                        style={isAccentLink ? {
                                            color: accentColor || '#75698d',
                                            borderColor: accentColor ? `${accentColor}80` : 'rgba(117,105,141,0.5)'
                                        } : {}}
                                        onMouseEnter={(e) => {
                                            if (isAccentLink) {
                                                e.currentTarget.style.backgroundColor = accentColor || '#75698d';
                                                e.currentTarget.style.color = 'white';
                                            }
                                        }}
                                        onMouseLeave={(e) => {
                                            if (isAccentLink) {
                                                e.currentTarget.style.backgroundColor = 'transparent';
                                                e.currentTarget.style.color = accentColor || '#75698d';
                                            }
                                        }}
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
