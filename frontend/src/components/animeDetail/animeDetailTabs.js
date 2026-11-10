import { BarChart3, Disc, Film, Mic, Tv, Users } from 'lucide-react';

// Memoized tab configuration to prevent re-renders
export const TABS = [
    { id: 'overview', label: 'Overview', icon: Film, path: 'overview' },
    { id: 'watch', label: 'Watch', icon: Tv, path: 'watch' },
    { id: 'themes', label: 'Themes', icon: Disc, path: 'themes' },
    { id: 'stats', label: 'Stats', icon: BarChart3, path: 'stats' },
    { id: 'characters', label: 'Characters', icon: Users, path: 'characters' },
    { id: 'staff', label: 'Staff', icon: Mic, path: 'staff' },
];

export const DEFAULT_TAB_ID = 'overview';
export const WATCH_PREVIEW_PAGE_SIZE = 4;
export const WATCH_TAB_PAGE_SIZE = 50;
export const DETAIL_RELATION_PAGE_SIZE = 50;

export const getTabByPath = (tabPath) => {
    const normalizedPath = tabPath?.replace(/^\/+|\/+$/g, '') || '';
    if (!normalizedPath) {
        return TABS.find((tab) => tab.id === DEFAULT_TAB_ID) || null;
    }

    return TABS.find((tab) => tab.path === normalizedPath) || null;
};

export const getTabHref = (slug, tabId) => {
    const tab = TABS.find((entry) => entry.id === tabId);
    if (!tab?.path) {
        return `/anime/${slug}`;
    }

    return `/anime/${slug}/${tab.path}`;
};
