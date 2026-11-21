import useScrollFade from '../../hooks/useScrollFade';

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'anime_list', label: 'Anime list' },
    { id: 'friends', label: 'Friends' },
    { id: 'favorites', label: 'Favorites' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'activity', label: 'Activity' },
    { id: 'insights', label: 'Stats' },
];

/**
 * Profile sections as quiet text tabs on a hairline. On phones the row
 * scrolls, with an edge fade where tabs are hidden.
 */
export default function ProfileTabs({ activeTab, onTabChange }) {
    const fadeRef = useScrollFade();

    return (
        <nav aria-label="Profile sections" className="profile-tabs page-container mt-10 md:mt-12">
            <div ref={fadeRef} className="scroll-fade overflow-x-auto scrollbar-hide border-b border-white/[0.06]">
                <div className="flex w-max gap-6 md:gap-8">
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                onClick={() => onTabChange(tab.id)}
                                aria-current={isActive ? 'page' : undefined}
                                className={`-mb-px min-h-[2.75rem] shrink-0 whitespace-nowrap border-b-2 py-3 text-[15px] font-medium transition-colors duration-150 ${isActive
                                    ? 'border-[var(--signature)] text-[var(--text-1)]'
                                    : 'border-transparent text-[var(--text-2)] hover:text-[var(--text-1)]'
                                    }`}
                            >
                                {tab.label}
                            </button>
                        );
                    })}
                </div>
            </div>
        </nav>
    );
}
