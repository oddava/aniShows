import { BarChart3, Users, Star, TrendingUp, Activity, Calendar } from 'lucide-react';

export default function StatsTab({ anime, accentColor }) {
    // Calculate total platform members from status_distribution
    const distribution = anime?.status_distribution || {};
    const totalPlatformMembers = Object.values(distribution).reduce((a, b) => a + b, 0);
    
    const statuses = [
        { key: 'Plan to Watch', label: 'Plan', color: '#4ade80' },
        { key: 'Watching', label: 'Watch', color: '#06b6d4' },
        { key: 'On Hold', label: 'Hold', color: '#a855f7' },
        { key: 'Completed', label: 'Done', color: '#f472b6' },
        { key: 'Dropped', label: 'Drop', color: '#f43f5e' },
    ];

    return (
        <div className="animate-tab-content space-y-8">
            {/* Overview Stats Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
                <StatCard
                    icon={Users}
                    label="Total Members"
                    value={totalPlatformMembers > 0 ? totalPlatformMembers.toLocaleString() : '0'}
                    accentColor={accentColor}
                />
                <StatCard
                    icon={Star}
                    label="Average Score"
                    value={anime?.rating || 'N/A'}
                    accentColor={accentColor}
                    subtext={anime?.rating ? '/ 10' : ''}
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
                <div className="bg-dark-100/50 rounded-2xl p-6 border border-gray-800">
                    <h3 className="text-[10px] font-black text-gray-500 uppercase tracking-[0.2em] mb-6">
                        Status Distribution
                    </h3>
                    
                    <div className="grid grid-cols-5 gap-2 mb-4">
                        {statuses.map(({ key, label, color }) => {
                            const count = distribution[key] || 0;
                            const isActive = count > 0;
                            return (
                                <div key={key} className="flex flex-col items-center text-center">
                                    <span className={`font-black leading-none ${isActive ? 'text-white text-xl' : 'text-gray-700 text-sm'}`}>
                                        {count}
                                    </span>
                                    <span 
                                        className="text-[9px] font-bold uppercase tracking-wide mt-1.5"
                                        style={{ color: isActive ? color : '#374151' }}
                                    >
                                        {label}
                                    </span>
                                </div>
                            );
                        })}
                    </div>
                    
                    <div className="relative h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                        <div className="absolute inset-0 flex items-center gap-[1px]">
                            {totalPlatformMembers > 0 ? (
                                statuses.map(({ key, color }) => {
                                    const count = distribution[key] || 0;
                                    const width = totalPlatformMembers > 0 ? (count / totalPlatformMembers) * 100 : 0;
                                    if (width === 0) return null;
                                    return (
                                        <div
                                            key={key}
                                            className="h-full first:rounded-l-full last:rounded-r-full"
                                            style={{
                                                width: `${width}%`,
                                                backgroundColor: color,
                                                borderRadius: totalPlatformMembers === count ? '999px' : undefined
                                            }}
                                        />
                                    );
                                })
                            ) : (
                                <div className="h-full w-full bg-gray-700 rounded-full" />
                            )}
                        </div>
                    </div>
                </div>
                {/* Season Info */}
                {(anime?.season || anime?.season_year) && (
                    <div className="bg-dark-100/50 rounded-2xl p-6 border border-gray-800">
                        <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                            <Calendar className="w-5 h-5" style={{ color: accentColor || '#8b5cf6' }} />
                            Season Information
                        </h3>
                        <div className="space-y-3">
                            <div className="flex justify-between">
                                <span className="text-gray-400">Season</span>
                                <span className="text-white font-medium capitalize">
                                    {anime.season?.toLowerCase()} {anime.season_year}
                                </span>
                            </div>
                        </div>
                    </div>
                )}

                {/* Scores by Category */}
                <div className="bg-dark-100/50 rounded-2xl p-6 border border-gray-800">
                    <h3 className="text-lg font-bold text-white mb-4 flex items-center gap-2">
                        <BarChart3 className="w-5 h-5" style={{ color: accentColor || '#8b5cf6' }} />
                        Rankings
                    </h3>
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
                style={{ color: accentColor || '#8b5cf6' }} 
            />
            <p className="text-2xl font-black text-white">{value}{subtext}</p>
            <p className="text-xs text-gray-500 font-medium uppercase tracking-wider">{label}</p>
        </div>
    );
}
