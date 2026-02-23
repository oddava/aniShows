import { Heart, List, MessageSquare, BarChart3, Activity } from 'lucide-react';

export default function ProfileTabs({ activeTab, onTabChange, counts = {} }) {
    const tabs = [
        { id: 'favorites', label: 'Favorites', shortLabel: 'Favs', icon: Heart, count: counts.favorites },
        { id: 'anime_list', label: 'Anime List', shortLabel: 'List', icon: List, count: counts.anime },
        { id: 'reviews', label: 'Reviews', shortLabel: 'Reviews', icon: MessageSquare, count: counts.reviews },
        { id: 'activity', label: 'Activity', shortLabel: 'Activity', icon: Activity, count: null },
        { id: 'insights', label: 'Insights', shortLabel: 'Stats', icon: BarChart3, count: null },
    ];

    return (
        <div className="max-w-7xl mx-auto px-4 mb-8">
            <div className="flex gap-4 sm:gap-6 md:gap-8 border-b border-gray-800 overflow-x-auto scrollbar-hide">
                {tabs.map((tab) => (
                    <button
                        key={tab.id}
                        onClick={() => onTabChange(tab.id)}
                        className={`pb-3 px-1 font-semibold text-xs sm:text-sm transition-all duration-200 whitespace-nowrap flex items-center gap-1 sm:gap-2 relative flex-shrink-0
                            ${activeTab === tab.id
                                ? 'text-white'
                                : 'text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        <tab.icon className={`w-3 h-3 sm:w-4 sm:h-4 ${activeTab === tab.id ? 'text-accent' : ''}`} />
                        <span className="hidden sm:inline">{tab.label}</span>
                        <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
                        {tab.count !== null && tab.count > 0 && (
                            <span className={`text-xs opacity-60 ${activeTab === tab.id ? 'text-accent' : ''}`}>
                                ({tab.count})
                            </span>
                        )}

                        {activeTab === tab.id && (
                            <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
                        )}
                    </button>
                ))}
            </div>
        </div>
    );
}
