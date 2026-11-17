import { useRef } from 'react';

export const SETTINGS_TABS = [
    { key: 'profile', label: 'Profile' },
    { key: 'badges', label: 'Badges' },
    { key: 'account', label: 'Account' },
    { key: 'notifications', label: 'Notifications' },
];

export const settingsTabId = (key) => `settings-tab-${key}`;
export const settingsPanelId = (key) => `settings-panel-${key}`;

/** Tabs this user can open: Badges only when they have some. */
export const visibleSettingsTabs = (user) =>
    SETTINGS_TABS.filter((tab) => tab.key !== 'badges' || user?.total_badges_count > 0);

/**
 * The tab bar at the top of the Settings page: a WAI-ARIA tablist with a
 * roving tabIndex. Left/Right move (and wrap), Home/End jump to the ends.
 */
export default function SettingsTabs({ user, activeTab, setActiveTab }) {
    const tabs = visibleSettingsTabs(user);
    const tabRefs = useRef({});

    const activate = (key) => {
        setActiveTab(key);
        tabRefs.current[key]?.focus();
    };

    const handleKeyDown = (event) => {
        const index = tabs.findIndex((tab) => tab.key === activeTab);
        const last = tabs.length - 1;
        let next;
        switch (event.key) {
            case 'ArrowRight':
                next = index >= last ? 0 : index + 1;
                break;
            case 'ArrowLeft':
                next = index <= 0 ? last : index - 1;
                break;
            case 'Home':
                next = 0;
                break;
            case 'End':
                next = last;
                break;
            default:
                return;
        }
        event.preventDefault();
        activate(tabs[next].key);
    };

    return (
        <div
            role="tablist"
            aria-label="Settings sections"
            onKeyDown={handleKeyDown}
            className="flex gap-1 sm:gap-4 mb-8 border-b border-gray-800 overflow-x-auto scrollbar-hide whitespace-nowrap touch-pan-x -mx-4 px-4 sm:mx-0 sm:px-0"
        >
            {tabs.map(({ key, label }) => {
                const isActive = activeTab === key;
                return (
                    <button
                        key={key}
                        ref={(node) => { tabRefs.current[key] = node; }}
                        type="button"
                        role="tab"
                        id={settingsTabId(key)}
                        aria-selected={isActive}
                        aria-controls={isActive ? settingsPanelId(key) : undefined}
                        tabIndex={isActive ? 0 : -1}
                        onClick={() => setActiveTab(key)}
                        className={`flex items-center gap-1.5 sm:gap-2 pb-3 sm:pb-4 px-2 sm:px-3 text-sm sm:text-base font-medium transition-all duration-200 relative shrink-0
                        ${isActive ? 'text-accent' : 'text-gray-400 hover:text-white'}`}
                    >
                        {label}
                        <div className={`absolute bottom-0 left-0 w-full h-0.5 bg-accent-dark transition-transform duration-300 origin-left
                        ${isActive ? 'scale-x-100' : 'scale-x-0'}`} />
                    </button>
                );
            })}
        </div>
    );
}
