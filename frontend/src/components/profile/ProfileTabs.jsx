import { useEffect, useRef } from 'react';
import useScrollFade from '../../hooks/useScrollFade';
import useActivePill from '../../hooks/useActivePill';

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
    const navRef = useRef(null);
    const pill = useActivePill();
    // Only when the tab changes does the strip scroll it into view.
    useEffect(() => {
        navRef.current?.querySelector('[data-active-tab]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [activeTab]);

    return (
        <nav ref={navRef} aria-label="Profile sections" className="profile-tabs page-container mt-10 md:mt-12">
            <div ref={fadeRef} className="scroll-fade -mx-4 overflow-x-auto scroll-px-4 px-4 scrollbar-hide sm:mx-0 sm:px-0">
                <div ref={pill.hostRef} className="pill-host flex w-max gap-1">
                    <span ref={pill.pillRef} aria-hidden="true" className="active-pill" />
                    {TABS.map((tab) => {
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                type="button"
                                data-active-tab={isActive ? 'true' : undefined}
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
