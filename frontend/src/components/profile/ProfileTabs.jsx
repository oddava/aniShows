import { useEffect, useRef, useState } from 'react';
import { ChevronRight } from 'lucide-react';
import useScrollFade from '../../hooks/useScrollFade';
import useActivePill from '../../hooks/useActivePill';
import ProfileAvatar from './ProfileAvatar';

const TABS = [
    { id: 'overview', label: 'Overview' },
    { id: 'anime_list', label: 'Anime list' },
    { id: 'favorites', label: 'Favorites' },
    { id: 'reviews', label: 'Reviews' },
    { id: 'activity', label: 'Activity' },
    { id: 'friends', label: 'Friends' },
    { id: 'insights', label: 'Stats' },
];

/**
 * Profile sections in a bar that sticks to the top as you scroll. Once the
 * hero has scrolled away, the person's avatar and name slide in at its left
 * (as on X), so you always know whose profile this is. The current tab
 * carries a soft fill. On phones the row scrolls, with an edge fade.
 */
export default function ProfileTabs({ activeTab, onTabChange, displayUser }) {
    const fadeRef = useScrollFade();
    const navRef = useRef(null);
    const sentinelRef = useRef(null);
    const pill = useActivePill();
    const [stuck, setStuck] = useState(false);
    const scrollerRef = useRef(null);

    // Only when the tab changes does the strip scroll it into view.
    useEffect(() => {
        navRef.current?.querySelector('[data-active-tab]')?.scrollIntoView?.({ block: 'nearest', inline: 'nearest' });
    }, [activeTab]);

    useEffect(() => {
        const sentinel = sentinelRef.current;
        if (!sentinel || typeof IntersectionObserver !== 'function') return undefined;
        const observer = new IntersectionObserver(
            ([entry]) => setStuck(!entry.isIntersecting && entry.boundingClientRect.top < 0),
            { threshold: 0 },
        );
        observer.observe(sentinel);
        return () => observer.disconnect();
    }, []);

    const name = displayUser?.display_name?.trim() || displayUser?.username;

    return (
        <>
            <div ref={sentinelRef} aria-hidden="true" data-profile-tabs-top className="h-px" />
            <nav
                ref={navRef}
                aria-label="Profile sections"
                data-stuck={stuck ? 'true' : undefined}
                className="profile-tabs sticky top-0 z-30 mt-5 md:mt-7"
            >
                <div className="page-container flex items-center">
                    <div
                        aria-hidden={!stuck}
                        className={`profile-tabs__who flex shrink-0 items-center gap-2.5 overflow-hidden ${stuck ? 'is-shown' : ''}`}
                    >
                        <ProfileAvatar avatar={displayUser?.avatar} username={displayUser?.username} className="h-8 w-8 text-sm" />
                        <span className="max-w-[10rem] truncate text-[15px] font-medium text-[var(--text-2)]">{name}</span>
                    </div>
                    <div className="profile-tabs__scroller relative -mr-4 min-w-0 flex-1 sm:mr-0">
                    <div ref={(node) => { fadeRef(node); scrollerRef.current = node; }} className="scroll-fade overflow-x-auto scroll-px-4 pr-4 scrollbar-hide sm:pr-0">
                        <div ref={pill.hostRef} className="pill-host profile-tabs__host flex w-max gap-1 py-2">
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
                                        className={`inline-flex min-h-[2.75rem] shrink-0 items-center whitespace-nowrap rounded-lg px-3 text-[15px] sm:px-3.5 font-medium transition-colors duration-150 ${isActive
                                            ? 'text-[var(--signature)]'
                                            : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'
                                            }`}
                                    >
                                        {tab.label}
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                    <button
                        type="button"
                        tabIndex={-1}
                        aria-hidden="true"
                        onClick={() => scrollerRef.current?.scrollBy({ left: 160, behavior: 'smooth' })}
                        className="profile-tabs__more absolute inset-y-0 right-0 flex w-11 items-center justify-end pr-3 text-[var(--text-2)] sm:hidden"
                    >
                        <ChevronRight className="h-4 w-4" />
                    </button>
                    </div>
                </div>
            </nav>
        </>
    );
}
