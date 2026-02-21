import { useState, useEffect, useCallback } from 'react';
import { Users, Play, Clock, Trophy, Sparkles, ArrowDownAZ, Grid3X3, List, LayoutGrid } from 'lucide-react';

// Browse Tabs for quick context switching
export const BROWSE_TABS = [
    { key: 'popular', label: 'Most Popular', icon: Users },
    { key: 'current', label: 'This Season', icon: Play },
    { key: 'upcoming', label: 'Upcoming', icon: Clock },
    { key: 'top', label: 'All Time Best', icon: Trophy },
    { key: 'newest', label: 'Newest', icon: Sparkles },
    { key: 'title', label: 'A-Z', icon: ArrowDownAZ },
];

export const SORT_OPTIONS = [
    { value: 'trending', label: 'Trending Now' },
    { value: 'popular', label: 'Most Popular' },
    { value: 'rating', label: 'Highest Rated' },
    { value: 'newest', label: 'Newest' },
    { value: 'upcoming', label: 'Upcoming' },
    { value: 'title', label: 'A-Z' },
];

export const TYPE_OPTIONS = [
    { value: 'TV', label: 'TV Series' },
    { value: 'Movie', label: 'Movies' },
    { value: 'OVA', label: 'OVA' },
    { value: 'Special', label: 'Specials' },
];

export const STATUS_OPTIONS = [
    { value: 'Airing', label: 'Currently Airing' },
    { value: 'Finished', label: 'Finished' },
    { value: 'Upcoming', label: 'Not Yet Aired' },
];

export const SEASON_OPTIONS = [
    { value: 'winter', label: 'Winter (Jan-Mar)' },
    { value: 'spring', label: 'Spring (Apr-Jun)' },
    { value: 'summer', label: 'Summer (Jul-Sep)' },
    { value: 'fall', label: 'Fall (Oct-Dec)' },
];

export const VIEW_MODES = [
    { value: 'grid', icon: Grid3X3, label: 'Grid' },
    { value: 'list', icon: List, label: 'List' },
    { value: 'minimal', icon: LayoutGrid, label: 'Minimal' },
];

// Generate year options from 1960 to current year + 1
const currentYear = new Date().getFullYear();
export const YEAR_OPTIONS = Array.from({ length: currentYear - 1960 + 2 }, (_, i) => currentYear + 1 - i);

/**
 * Hook to manage browse tab state and season logic
 */
export function useBrowseTabs(currentSort, currentSeason, currentYear) {
    const [activeTab, setActiveTab] = useState('popular');
    const [isTabSwitching, setIsTabSwitching] = useState(false);
    const [minLoadingTime, setMinLoadingTime] = useState(false);

    // Update active tab based on current params
    useEffect(() => {
        if (currentSort === 'trending') {
            setActiveTab('trending');
        } else if (currentSeason && currentYear) {
            const d = new Date();
            const m = d.getMonth();
            const y = d.getFullYear();
            let thisSeason = 'winter';
            if (m >= 3 && m <= 5) thisSeason = 'spring';
            else if (m >= 6 && m <= 8) thisSeason = 'summer';
            else if (m >= 9 && m <= 11) thisSeason = 'fall';

            if (currentSeason === thisSeason && parseInt(currentYear) === y) {
                setActiveTab('current');
            } else {
                setActiveTab('upcoming');
            }
        } else if (currentSort === 'rating') {
            setActiveTab('top');
        } else if (currentSort === 'newest') {
            setActiveTab('newest');
        } else if (currentSort === 'title') {
            setActiveTab('title');
        } else if (currentSort === 'popular') {
            setActiveTab('popular');
        } else {
            setActiveTab(null);
        }
    }, [currentSort, currentSeason, currentYear]);

    // Handle tab change and return new search params
    const handleTabChange = useCallback((key, currentSearchParams) => {
        const newParams = new URLSearchParams(currentSearchParams);

        // Reset base filters
        newParams.delete('sort');
        newParams.delete('status');
        newParams.delete('season');
        newParams.delete('year');

        const d = new Date();
        const month = d.getMonth();
        const year = d.getFullYear();

        switch (key) {
            case 'trending':
                newParams.set('sort', 'trending');
                break;
            case 'current': {
                let season = 'winter';
                if (month >= 3 && month <= 5) season = 'spring';
                else if (month >= 6 && month <= 8) season = 'summer';
                else if (month >= 9 && month <= 11) season = 'fall';

                newParams.set('season', season);
                newParams.set('year', year.toString());
                newParams.set('sort', 'popular');
                break;
            }
            case 'upcoming': {
                let nextSeason = 'winter';
                let nextYear = year;

                if (month >= 0 && month <= 2) { nextSeason = 'spring'; }
                else if (month >= 3 && month <= 5) { nextSeason = 'summer'; }
                else if (month >= 6 && month <= 8) { nextSeason = 'fall'; }
                else { nextSeason = 'winter'; nextYear = year + 1; }

                newParams.set('season', nextSeason);
                newParams.set('year', nextYear.toString());
                newParams.set('sort', 'popular');
                break;
            }
            case 'top':
                newParams.set('sort', 'rating');
                break;
            case 'popular':
                newParams.set('sort', 'popular');
                break;
            case 'newest':
                newParams.set('sort', 'newest');
                break;
            case 'title':
                newParams.set('sort', 'title');
                break;
            default:
                break;
        }

        setActiveTab(key);
        setIsTabSwitching(true);

        return newParams;
    }, []);

    // Reset tab switching state when data loads with minimum delay
    useEffect(() => {
        // Start minimum loading timer when tab switching begins
        if (isTabSwitching) {
            setMinLoadingTime(false);
            const timer = setTimeout(() => {
                setMinLoadingTime(true);
            }, 500);
            return () => clearTimeout(timer);
        }
    }, [isTabSwitching]);

    // Reset tab switching when loading completes
    useEffect(() => {
        if (!isTabSwitching) return;
        
        // This effect will be called when isLoading changes
        // The actual reset logic should be handled by the component using this hook
    }, [isTabSwitching]);

    const resetTabSwitching = useCallback(() => {
        setIsTabSwitching(false);
        setMinLoadingTime(false);
    }, []);

    return {
        activeTab,
        isTabSwitching,
        minLoadingTime,
        handleTabChange,
        resetTabSwitching,
        setIsTabSwitching,
    };
}

export default useBrowseTabs;
