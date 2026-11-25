import { useRef } from 'react';
import useActivePill from '../../hooks/useActivePill';

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
    const pill = useActivePill();

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

    // Soft-fill tabs, as on My list and the anime pages: the active one sits
    // on a light fill, no underline.
    return (
        <div
            role="tablist"
            aria-label="Settings sections"
            onKeyDown={handleKeyDown}
            ref={pill.hostRef}
            className="pill-host mt-6 flex gap-1 overflow-x-auto scrollbar-hide whitespace-nowrap touch-pan-x -mx-4 px-4 md:mx-0 md:px-0"
        >
            <span ref={pill.pillRef} aria-hidden="true" className="active-pill" />
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
                        className={`inline-flex min-h-11 shrink-0 items-center rounded-lg px-3.5 text-[15px] font-medium transition-colors duration-150
                        ${isActive
                            ? 'bg-white/[0.07] text-[var(--text-1)]'
                            : 'text-[var(--text-2)] hover:bg-white/[0.04] hover:text-[var(--text-1)]'}`}
                    >
                        {label}
                    </button>
                );
            })}
        </div>
    );
}
