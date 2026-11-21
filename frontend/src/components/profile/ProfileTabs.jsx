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
            <div ref={fadeRef} className="scroll-fade -mx-4 overflow-x-auto scroll-px-4 px-4 scrollbar-hide sm:mx-0 sm:px-0">
                <div className="flex w-max gap-1">
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                ref={isActive ? (node) => node?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' }) : undefined}
                                onClick={() => onTabChange(tab.id)}
                                aria-current={isActive ? 'page' : undefined}
                                className={`min-h-[2.75rem] shrink-0 whitespace-nowrap rounded-lg px-3.5 text-[15px] font-medium transition-colors duration-150 ${isActive
                                    ? 'bg-white/[0.07] text-[var(--text-1)]'
                                    : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'
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
