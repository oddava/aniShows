import { BarChart3, Users, Star, TrendingUp, Activity } from 'lucide-react';
import StatusDistribution from './StatusDistribution';
import {
    formatCompactCount,
    getStatusDistributionTotal,
    normalizeStatusDistribution,
} from '../utils/statusDistribution';

export default function StatsTab({ anime, accentColor }) {
    const totalPlatformMembers = getStatusDistributionTotal(
        normalizeStatusDistribution(anime?.status_distribution)
    );
    const scoreLabel = anime?.rating != null
        ? (anime?.anilist_id ? 'on AniList' : '/ 10')
        : '';

    return (
        <div className="animate-tab-content space-y-8">
            {/* Overview Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard
                    icon={Users}
                    label="Total Members"
                    value={formatCompactCount(totalPlatformMembers)}
                    accentColor={accentColor}
                />
                <StatCard
                    icon={Star}
                    label="Average Score"
                    value={anime?.rating != null ? anime.rating : 'N/A'}
                    accentColor={accentColor}
                    subtext={scoreLabel}
                />
                <StatCard
                    icon={TrendingUp}
                    label="Popularity"
                    value={anime?.popularity_rank ? `#${anime.popularity_rank}` : 'N/A'}
                    accentColor={accentColor}
                />
                <StatCard
                    icon={Activity}
                    label="Site Rank"
                    value={anime?.site_rank ? `#${anime.site_rank}` : 'N/A'}
                    accentColor={accentColor}
                />
            </div>

            {/* Additional Info */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* Status Distribution */}
                <StatusDistribution anime={anime} />
                
                {/* Rankings */}
                <div className="bg-dark-100/50 rounded-2xl p-6 border border-gray-800">
                    <div className="flex items-center gap-2 mb-4">
                        <BarChart3 className="w-4 h-4 text-gray-500" />
                        <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em]">
                            Rankings
                        </h3>
                    </div>
                    <div className="space-y-3">
                        <div className="flex justify-between">
                            <span className="text-gray-400">Site Rank</span>
                            <span className="text-white font-medium">
                                {anime?.site_rank ? `#${anime.site_rank}` : 'N/A'}
                            </span>
                        </div>
                        <div className="flex justify-between">
                            <span className="text-gray-400">Popularity Rank</span>
                            <span className="text-white font-medium">
                                {anime?.popularity_rank ? `#${anime.popularity_rank}` : 'N/A'}
                            </span>
                        </div>
                        {anime?.trending_rank && (
                            <div className="flex justify-between">
                                <span className="text-gray-400">Trending Rank</span>
                                <span className="text-white font-medium">
                                    #{anime.trending_rank}
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}

function StatCard({ icon: Icon, label, value, subtext, accentColor }) {  // eslint-disable-line no-unused-vars
    return (
        <div className="bg-dark-100/50 rounded-xl p-4 border border-gray-800 hover:border-gray-700 transition-colors">
            <Icon 
                className="w-5 h-5 mb-2" 
                style={{ color: accentColor || '#75698d' }} 
            />
            <p className="text-2xl font-black text-white">
                {value}
                {subtext ? <span className="text-sm font-normal text-gray-400 ml-1">{subtext}</span> : ''}
            </p>
            <p className="text-[10px] text-gray-500 font-bold uppercase tracking-[0.12em]">{label}</p>
        </div>
    );
}
