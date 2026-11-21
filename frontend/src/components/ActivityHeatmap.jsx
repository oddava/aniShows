import { useCallback, useMemo, useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import useScrollFade from '../hooks/useScrollFade';
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
export default function ActivityHeatmap({ activityData = [], accentColor, hideWhenEmpty = false }) {
    const { theme } = useTheme();
    const isPastel = theme === 'retro-anime';
    const { baseColor: profileAccentColor, lightColor: profileAccentLight } = getProfileAccentTheme(accentColor);
    
    const [hoveredDay, setHoveredDay] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const [persistedDay, setPersistedDay] = useState(null);
    const scrollRef = useRef(null);
    const fadeRef = useScrollFade();
    const setScrollEl = useCallback((el) => {
        scrollRef.current = el;
        fadeRef(el);
    }, [fadeRef]);

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
        if (count === 0) return { backgroundColor: 'rgba(255, 255, 255, 0.05)' };
        if (isPastel) {
            if (count <= 1) return { backgroundColor: 'rgba(232, 90, 156, 0.2)' };
            if (count <= 3) return { backgroundColor: 'rgba(232, 90, 156, 0.4)' };
            if (count <= 5) return { backgroundColor: 'rgba(232, 90, 156, 0.6)' };
            if (count <= 7) return { backgroundColor: 'rgba(232, 90, 156, 0.8)' };
            return { backgroundColor: 'rgb(232, 90, 156)' };
        }
        if (count <= 1) return { backgroundColor: toRgba(profileAccentColor, 0.2) };
        if (count <= 3) return { backgroundColor: toRgba(profileAccentColor, 0.4) };
        if (count <= 5) return { backgroundColor: toRgba(profileAccentColor, 0.6) };
        if (count <= 7) return { backgroundColor: toRgba(profileAccentColor, 0.8) };
        return { backgroundColor: profileAccentColor };
    };

    const getHoverStyle = (count) => {
        if (count === 0) return { backgroundColor: 'rgba(255, 255, 255, 0.13)' };
        if (isPastel) {
            if (count <= 1) return { backgroundColor: 'rgba(232, 90, 156, 0.4)' };
            if (count <= 3) return { backgroundColor: 'rgba(232, 90, 156, 0.6)' };
            if (count <= 5) return { backgroundColor: 'rgba(232, 90, 156, 0.8)' };
            if (count <= 7) return { backgroundColor: 'rgb(232, 90, 156)' };
            return { backgroundColor: 'rgba(255, 133, 184, 1)' };
        }
        if (count <= 1) return { backgroundColor: toRgba(profileAccentColor, 0.4) };
        if (count <= 3) return { backgroundColor: toRgba(profileAccentColor, 0.6) };
        if (count <= 5) return { backgroundColor: toRgba(profileAccentColor, 0.8) };
        if (count <= 7) return { backgroundColor: profileAccentColor };
        return { backgroundColor: profileAccentLight };
    };

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const legendColor = (alpha) => (isPastel
        ? `rgba(232, 90, 156, ${alpha})`
        : toRgba(profileAccentColor, alpha));

    if (hideWhenEmpty && stats.totalActivity === 0) return null;

    return (
        <div className="relative w-full max-w-full">
            <p className="mb-4 text-[15px] text-[var(--text-2)] tabular">
                {stats.totalActivity > 0 ? (
                    <>
                        <span title="Episodes logged here in the last 12 months. Imports and shows marked completed in one go are not day-by-day activity.">
                            {stats.totalActivity.toLocaleString()} {stats.totalActivity === 1 ? 'episode' : 'episodes'} logged this year
                        </span>
                        {stats.currentStreak > 0 && (
                            <> · {stats.currentStreak}-day streak</>
                        )}
                    </>
                ) : 'Nothing logged this year yet.'}
            </p>

            <div ref={setScrollEl} className="scroll-fade overflow-x-auto scrollbar-hide">
                <div className="inline-block min-w-max py-1">
                    {/* Month labels */}
                    <div className="mb-1 flex h-5 gap-[4px] text-xs text-[var(--text-2)]">
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
                                            setTooltipPos({ x: e.clientX, y: e.clientY });
                                        }}
                                        onMouseEnter={(e) => {
                                            setHoveredDay(day);
                                            setTooltipPos({ x: e.clientX, y: e.clientY });
                                        }}
                                        onMouseLeave={() => {
                                            setHoveredDay(null);
                                        }}
                                        className="h-[14px] w-[14px] cursor-pointer rounded-[3px] transition-colors duration-150"
                                        style={hoveredDay?.date === day.date ? getHoverStyle(day.count) : getColorStyle(day.count)}
                                    />
                                ))}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            {/* Legend */}
            <div className="mt-3 flex items-center justify-end gap-2 text-xs text-[var(--text-2)]">
                <span>Less</span>
                <div className="flex gap-1">
                    {[0.2, 0.4, 0.6, 0.8, 1].map((alpha) => (
                        <div key={alpha} className="h-[10px] w-[10px] rounded-[2px]" style={{ backgroundColor: legendColor(alpha) }} />
                    ))}
                </div>
                <span>More</span>
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
                        <div className="min-w-[150px] rounded-[var(--radius-md)] border border-white/[0.08] bg-[var(--ink-3)] px-3.5 py-2.5 shadow-lg shadow-black/30">
                            <p className="mb-1 whitespace-nowrap text-[13px] font-medium text-[var(--text-1)]">
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
                                <p className="text-[13px] text-[var(--text-2)] tabular">
                                    {persistedDay.count} {persistedDay.count === 1 ? 'episode' : 'episodes'}
                                </p>
                            </div>
                            {/* Arrow */}
                            <div className="absolute -bottom-1 left-1/2 h-2 w-2 -translate-x-1/2 rotate-45 border-b border-r border-white/[0.08] bg-[var(--ink-3)]" />
                        </div>
                    )}
                </div>
            </TooltipPortal>
        </div>
    );
}
