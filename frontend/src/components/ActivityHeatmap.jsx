import { useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTheme } from '../context/ThemeContext';
import {
    getProfileAccentTheme,
    normalizeProfilePrimaryColor,
} from '../utils/profileAccent';

function hexToRgb(hex) {
    const normalized = normalizeProfilePrimaryColor(hex).replace('#', '');
    return {
        red: parseInt(normalized.slice(0, 2), 16),
        green: parseInt(normalized.slice(2, 4), 16),
        blue: parseInt(normalized.slice(4, 6), 16),
    };
}

function toRgba(hex, alpha) {
    const { red, green, blue } = hexToRgb(hex);
    return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

// Tooltip Portal component
function TooltipPortal({ children }) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => {
        setMounted(true);
        return () => setMounted(false);
    }, []);
    if (!mounted) return null;
    return createPortal(children, document.body);
}

/**
 * ActivityHeatmap - GitHub-style contribution/watching activity graph
 * Shows user's anime watching activity over the past year
 */
export default function ActivityHeatmap({ activityData = [], accentColor }) {
    const { theme } = useTheme();
    const isPastel = theme === 'retro-anime';
    const { baseColor: profileAccentColor, lightColor: profileAccentLight } = getProfileAccentTheme(accentColor);
    
    const [hoveredDay, setHoveredDay] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const [persistedDay, setPersistedDay] = useState(null);
    const scrollRef = useRef(null);

    // Keep tooltip content stable during fade out
    useEffect(() => {
        if (hoveredDay) setPersistedDay(hoveredDay);
    }, [hoveredDay]);

    // Generate the past 52 weeks of dates
    const weeks = useMemo(() => {
        const today = new Date();
        const result = [];

        // Create 52 weeks of data in chronological order (oldest -> newest)
        for (let week = 51; week >= 0; week--) {
            const weekData = [];
            for (let day = 0; day < 7; day++) {
                const date = new Date(today);
                date.setDate(date.getDate() - (week * 7 + (6 - day)));

                // Find activity for this date
                const dateStr = date.toISOString().split('T')[0];
                const activity = activityData.find(a => a.date === dateStr);

                weekData.push({
                    date: dateStr,
                    count: activity?.count || 0,
                    displayDate: date.toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                    })
                });
            }
            result.push(weekData);
        }

        return result;
    }, [activityData]);

    // Keep the newest weeks visible by default when horizontal overflow exists.
    useEffect(() => {
        const el = scrollRef.current;
        if (!el) return;
        const maxScrollLeft = Math.max(0, el.scrollWidth - el.clientWidth);
        el.scrollLeft = maxScrollLeft;
    }, [weeks]);

    // Calculate stats
    const stats = useMemo(() => {
        const totalActivity = activityData.reduce((sum, a) => sum + a.count, 0);
        const activeDays = activityData.filter(a => a.count > 0).length;

        // Calculate current streak — only counts consecutive days ending today/yesterday
        let currentStreak = 0;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const sortedActivity = [...activityData]
            .filter(a => a.count > 0)
            .sort((a, b) => new Date(b.date) - new Date(a.date));

        if (sortedActivity.length > 0) {
            const mostRecent = new Date(sortedActivity[0].date);
            mostRecent.setHours(0, 0, 0, 0);
            const gapFromToday = Math.round((today - mostRecent) / (1000 * 60 * 60 * 24));

            // Only count streak if most recent activity is today or yesterday
            if (gapFromToday <= 1) {
                let expectedDate = new Date(mostRecent);
                for (const activity of sortedActivity) {
                    const actDate = new Date(activity.date);
                    actDate.setHours(0, 0, 0, 0);
                    const diff = Math.round((expectedDate - actDate) / (1000 * 60 * 60 * 24));
                    if (diff === 0) {
                        currentStreak++;
                        expectedDate.setDate(expectedDate.getDate() - 1);
                    } else if (diff > 0) {
                        break; // Gap found
                    }
                    // diff < 0 shouldn't happen with sorted data, skip
                }
            }
        }

        return { totalActivity, activeDays, currentStreak };
    }, [activityData]);

    // Get color intensity based on count - using inline styles for better theme support
    const getColorStyle = (count) => {
        if (count === 0) return { backgroundColor: 'rgba(100, 100, 110, 0.25)' };
        if (count <= 2) return { backgroundColor: 'rgba(100, 100, 110, 0.45)' };
        if (isPastel) {
            if (count <= 4) return { backgroundColor: 'rgba(232, 90, 156, 0.6)' };
            if (count <= 6) return { backgroundColor: 'rgba(232, 90, 156, 0.85)' };
            return { backgroundColor: 'rgb(232, 90, 156)' };
        }
        if (count <= 4) return { backgroundColor: toRgba(profileAccentColor, 0.6) };
        if (count <= 6) return { backgroundColor: toRgba(profileAccentColor, 0.85) };
        return { backgroundColor: profileAccentColor };
    };

    const getHoverStyle = (count) => {
        if (count === 0) return { backgroundColor: 'rgba(100, 100, 110, 0.45)' };
        if (count <= 2) return { backgroundColor: 'rgba(100, 100, 110, 0.65)' };
        if (isPastel) {
            if (count <= 4) return { backgroundColor: 'rgba(232, 90, 156, 0.8)' };
            if (count <= 6) return { backgroundColor: 'rgba(232, 90, 156, 1)' };
            return { backgroundColor: 'rgba(255, 133, 184, 1)' };
        }
        if (count <= 4) return { backgroundColor: toRgba(profileAccentColor, 0.8) };
        if (count <= 6) return { backgroundColor: profileAccentColor };
        return { backgroundColor: profileAccentLight };
    };

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    return (
        <div className="relative w-full max-w-full p-4 sm:p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
                <h3 className="text-xs font-bold uppercase tracking-[0.16em] text-gray-500">
                    Watching Activity
                </h3>

                {stats.totalActivity > 0 ? (
                    <div className="flex items-center gap-6">
                        <div className="flex flex-col items-end">
                            <span className="text-white font-black text-sm">{stats.totalActivity}</span>
                            <span className="text-[8px] text-gray-500 font-black uppercase tracking-widest">Episodes</span>
                        </div>
                        <div className="w-px h-6 bg-gray-700/30" />
                        <div className="flex flex-col items-end">
                            <span className="text-accent font-black text-sm">{stats.currentStreak}</span>
                            <span className="text-[8px] text-gray-500 font-black uppercase tracking-widest">Day Streak</span>
                        </div>
                    </div>
                ) : (
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 bg-dark-100/50 px-3 py-1 rounded-full border border-gray-700/30">No activity yet</span>
                )}
            </div>

            <div ref={scrollRef} className="flex gap-3 min-h-[140px] overflow-x-auto scrollbar-hide -mx-4 px-4 sm:mx-0 sm:px-0">

                {/* Overflown Content Area */}
                <div className="py-1 min-w-full">
                    <div className="inline-block min-w-max">
                        {/* Month labels */}
                        <div className="mb-1 flex h-6 gap-[4px] text-[10px] font-black uppercase tracking-[0.2em] text-gray-500">
                            {weeks.map((week, i) => {
                                const firstDay = new Date(week[0].date);
                                const isNewMonth = firstDay.getDate() <= 7;
                                const alignRight = i >= weeks.length - 2;

                                return (
                                    <div key={week[0].date} className="relative w-[14px]">
                                        {isNewMonth && (
                                            <span className={`absolute top-0 whitespace-nowrap ${alignRight ? 'right-0 text-right' : 'left-0'}`}>
                                                {months[firstDay.getMonth()]}
                                            </span>
                                        )}
                                    </div>
                                );
                            })}
                        </div>

                        {/* Cells Grid */}
                        <div className="flex gap-[4px]">
                            {weeks.map((week, weekIndex) => (
                                <div key={weekIndex} className="flex flex-col gap-[4px]">
                                    {week.map((day) => (
                                        <div
                                            key={day.date}
                                            onMouseMove={(e) => {
                                                setHoveredDay(day);
                                                setTooltipPos({
                                                    x: e.clientX,
                                                    y: e.clientY
                                                });
                                            }}
                                            onMouseEnter={(e) => {
                                                setHoveredDay(day);
                                                setTooltipPos({
                                                    x: e.clientX,
                                                    y: e.clientY
                                                });
                                            }}
                                            onMouseLeave={() => {
                                                setHoveredDay(null);
                                            }}
                                            className="w-[14px] h-[14px] rounded-[3px] transition-all duration-300 cursor-pointer"
                                            style={hoveredDay?.date === day.date ? getHoverStyle(day.count) : getColorStyle(day.count)}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>

                    </div>
                </div>
            </div>

            {/* Custom AniList-style Tooltip - Portal to body to avoid overflow clipping */}
            <TooltipPortal>
                <div
                    className="fixed z-[9999] pointer-events-none"
                    style={{
                        left: `${tooltipPos.x}px`,
                        top: `${tooltipPos.y}px`,
                        opacity: hoveredDay ? 1 : 0,
                        transform: `translate(-50%, ${hoveredDay ? 'calc(-100% - 15px)' : 'calc(-100% - 10px)'}) scale(${hoveredDay ? 1 : 0.96})`,
                        visibility: (hoveredDay || tooltipPos.x !== 0) ? 'visible' : 'hidden',
                        transition: 'opacity 0.3s ease-out, transform 0.3s cubic-bezier(0.34, 1.56, 0.64, 1), left 0.15s cubic-bezier(0.22, 1, 0.36, 1), top 0.15s cubic-bezier(0.22, 1, 0.36, 1)',
                        willChange: 'transform, left, top, opacity'
                    }}
                >
                    {/* Inner wrapper to keep content during fade out */}
                    {persistedDay && (
                        <div className="bg-dark-100/95 backdrop-blur-md border border-gray-700/30 rounded-xl px-4 py-2.5 shadow-[0_20px_50px_rgba(0,0,0,0.1)] min-w-[150px] ring-1 ring-gray-700/10">
                            <p className="text-white font-bold text-[11px] mb-1.5 whitespace-nowrap tracking-wide">
                                {new Date(persistedDay.date).toLocaleDateString('en-US', {
                                    weekday: 'long',
                                    month: 'short',
                                    day: 'numeric',
                                    year: 'numeric'
                                })}
                            </p>
                            <div className="flex items-center gap-2.5">
                                <div 
                                    className="w-2 h-2 rounded-full" 
                                    style={getColorStyle(persistedDay.count)} 
                                />
                                <p className="text-[11px] text-gray-400 font-medium">
                                    <span className="text-accent font-bold">{persistedDay.count}</span> episodes
                                </p>
                            </div>
                            {/* Arrow */}
                            <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-dark-100 border-r border-b border-gray-700/30 rotate-45" />
                        </div>
                    )}
                </div>
            </TooltipPortal>

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 mt-4">
                <div className="flex items-center gap-3">
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Less</span>
                    <div className="flex gap-1">
                        <div className="w-[10px] h-[10px] rounded-[2px]" style={{ backgroundColor: 'rgba(100, 100, 110, 0.25)' }} />
                        <div className="w-[10px] h-[10px] rounded-[2px]" style={{ backgroundColor: 'rgba(100, 100, 110, 0.45)' }} />
                        <div className="w-[10px] h-[10px] rounded-[2px]" style={{ backgroundColor: isPastel ? 'rgba(232, 90, 156, 0.6)' : toRgba(profileAccentColor, 0.6) }} />
                        <div className="w-[10px] h-[10px] rounded-[2px]" style={{ backgroundColor: isPastel ? 'rgba(232, 90, 156, 0.85)' : toRgba(profileAccentColor, 0.85) }} />
                        <div className="w-[10px] h-[10px] rounded-[2px]" style={{ backgroundColor: isPastel ? 'rgb(232, 90, 156)' : profileAccentColor }} />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">More</span>
                </div>
            </div>
        </div>
    );
}
