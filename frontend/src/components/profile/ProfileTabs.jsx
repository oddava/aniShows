import { Heart, List, MessageSquare, BarChart3, Activity, User as UserIcon } from 'lucide-react';

export default function ProfileTabs({ activeTab, onTabChange, counts = {} }) {
    const tabs = [
        { id: 'overview', label: 'Overview', shortLabel: 'Overview', count: null },
        { id: 'anime_list', label: 'Anime List', shortLabel: 'List', count: counts.anime },
        { id: 'friends', label: 'Friends', shortLabel: 'Friends', count: counts.friends },
        { id: 'favorites', label: 'Favorites', shortLabel: 'Favs', count: counts.favorites },
        { id: 'reviews', label: 'Reviews', shortLabel: 'Reviews', count: counts.reviews },
        { id: 'activity', label: 'Activity', shortLabel: 'Activity', count: null },
        { id: 'insights', label: 'Stats', shortLabel: 'Stats', count: null },
    ];

    return (
        <div className="mb-6 profile-tabs">
            <div className="max-w-7xl mx-auto px-4">
                <div className="flex gap-6 sm:gap-8 md:gap-12 overflow-x-auto scrollbar-hide px-2 sm:px-4">
                    {tabs.map((tab) => (
                        <button
                            key={tab.id}
                            onClick={() => onTabChange(tab.id)}
                        className={`py-4 px-1 font-semibold text-xs sm:text-[15px] transition-all duration-200 whitespace-nowrap flex items-center gap-2 relative flex-shrink-0
                            ${activeTab === tab.id
                                ? 'text-white'
                                : 'text-gray-400 hover:text-white'
                            }`}
                        >
                            <span className="hidden sm:inline">{tab.label}</span>
                            <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
                            
                            {activeTab === tab.id && (
                                <div className="absolute bottom-0 left-0 right-0 h-0.5 bg-accent" />
                            )}
                        </button>
                    ))}
                </div>
            </div>
        </div>
    );
}