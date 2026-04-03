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
        <div className="mb-5 profile-tabs">
            <div className="max-w-7xl mx-auto px-4">
                <div className="overflow-x-auto scrollbar-hide">
                    <div className="flex w-max md:w-full md:justify-center gap-4 sm:gap-8 md:gap-12 border-b border-gray-800/30">
                        {tabs.map((tab) => (
                            <button
                                key={tab.id}
                                onClick={() => onTabChange(tab.id)}
                                className={`relative flex-shrink-0 whitespace-nowrap border-b-2 px-1 py-3 text-[12px] font-semibold transition-colors duration-200 sm:text-[15px]
                                ${activeTab === tab.id
                                    ? 'border-accent text-white'
                                    : 'border-transparent text-gray-400 hover:text-white'
                                }`}
                            >
                                <span className="hidden sm:inline">{tab.label}</span>
                                <span className="sm:hidden">{tab.shortLabel || tab.label}</span>
                            </button>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
}
