import { useMemo, useState, useRef } from 'react';
import { Flame } from 'lucide-react';

/**
 * ActivityHeatmap - GitHub-style contribution/watching activity graph
 * Shows user's anime watching activity over the past year
 */
export default function ActivityHeatmap({ activityData = [] }) {
    const [hoveredDay, setHoveredDay] = useState(null);
    const [tooltipPos, setTooltipPos] = useState({ x: 0, y: 0 });
    const containerRef = useRef(null);

    // Generate the past 52 weeks of dates
    const weeks = useMemo(() => {
        const today = new Date();
        const result = [];

        // Create 26 weeks of data (approx 6 months)
        for (let week = 25; week >= 0; week--) {
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

    // Get color intensity based on count
    const getColorClass = (count) => {
        if (count === 0) return 'bg-white/[0.03] hover:bg-white/[0.08]';
        if (count <= 2) return 'bg-purple-900/40 hover:bg-purple-900/60';
        if (count <= 4) return 'bg-purple-700/60 hover:bg-purple-700/80';
        if (count <= 6) return 'bg-purple-500/80 hover:bg-purple-500/100 shadow-[0_0_10px_rgba(168,85,247,0.2)]';
        return 'bg-accent shadow-[0_0_15px_rgba(139,92,246,0.3)] hover:brightness-110';
    };

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <div className="p-4 sm:p-6 relative w-fit mx-auto" ref={containerRef}>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between mb-4 gap-4">
                <div>
                    <h3 className="text-white font-black uppercase tracking-widest text-[10px] flex items-center gap-2 mb-1">
                        <Flame className="w-3.5 h-3.5 text-orange-500" />
                        Watching Activity
                    </h3>
                    <p className="text-gray-500 text-[10px] font-bold uppercase tracking-wider">Consistency over the past year</p>
                </div>

                {stats.totalActivity > 0 ? (
                    <div className="flex items-center gap-6">
                        <div className="flex flex-col items-end">
                            <span className="text-white font-black text-sm">{stats.totalActivity}</span>
                            <span className="text-[8px] text-gray-400 font-black uppercase tracking-widest">Episodes</span>
                        </div>
                        <div className="w-px h-6 bg-white/10" />
                        <div className="flex flex-col items-end">
                            <div className="flex items-center gap-1">
                                <Flame className="w-3 h-3 text-orange-400" />
                                <span className="text-orange-400 font-black text-sm">{stats.currentStreak}</span>
                            </div>
                            <span className="text-[8px] text-gray-400 font-black uppercase tracking-widest">Day Streak</span>
                        </div>
                    </div>
                ) : (
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500 bg-white/5 px-3 py-1 rounded-full border border-white/5">No activity yet</span>
                )}
            </div>

            <div className="flex gap-3 min-h-[140px]">

                {/* Overflown Content Area */}
                <div className="overflow-x-auto scrollbar-hide py-1">
                    <div className="inline-block">
                        {/* Month labels */}
                        <div className="flex text-[10px] font-black uppercase tracking-[0.2em] text-gray-600 h-6 items-end mb-1 relative">
                            {weeks.map((week, i) => {
                                const firstDay = new Date(week[0].date);
                                const isNewMonth = firstDay.getDate() <= 7;
                                if (isNewMonth) {
                                    return (
                                        <div key={i} className="absolute" style={{ left: `${i * 18}px` }}>
                                            <span className="whitespace-nowrap">
                                                {months[firstDay.getMonth()]}
                                            </span>
                                        </div>
                                    );
                                }
                                return null;
                            })}
                        </div>

                        {/* Cells Grid */}
                        <div className="flex gap-[4px]">
                            {weeks.map((week, weekIndex) => (
                                <div key={weekIndex} className="flex flex-col gap-[4px]">
                                    {week.map((day) => (
                                        <div
                                            key={day.date}
                                            onMouseEnter={(e) => {
                                                const rect = e.target.getBoundingClientRect();
                                                const containerRect = containerRef.current.getBoundingClientRect();
                                                setHoveredDay(day);
                                                setTooltipPos({
                                                    x: rect.left - containerRect.left + rect.width / 2,
                                                    y: rect.top - containerRect.top
                                                });
                                            }}
                                            onMouseLeave={() => setHoveredDay(null)}
                                            className={`w-[14px] h-[14px] rounded-[3px] transition-all duration-300 cursor-pointer ${getColorClass(day.count)}`}
                                        />
                                    ))}
                                </div>
                            ))}
                        </div>

                    </div>
                </div>
            </div>

            {/* Custom AniList-style Tooltip - Moved outside overflow container */}
            {hoveredDay && (
                <div
                    className="absolute z-[100] pointer-events-none transform -translate-x-1/2 -translate-y-[calc(100%+8px)] animate-fade-in"
                    style={{ left: `${tooltipPos.x}px`, top: `${tooltipPos.y}px` }}
                >
                    <div className="bg-dark-200/95 backdrop-blur-xl border border-white/10 rounded-xl px-3 py-2.5 shadow-2xl min-w-[140px]">
                        <p className="text-white font-black text-[10px] mb-1.5 whitespace-nowrap opacity-90">
                            {new Date(hoveredDay.date).toLocaleDateString('en-US', {
                                weekday: 'short',
                                month: 'short',
                                day: 'numeric',
                                year: 'numeric'
                            })}
                        </p>
                        <div className="flex items-center gap-2">
                            <div className={`w-2 h-2 rounded-full ${getColorClass(hoveredDay.count)}`} />
                            <p className="text-[11px] text-gray-300 font-bold">
                                Amount: <span className="text-white">{hoveredDay.count}</span>
                            </p>
                        </div>

                        {/* Arrow */}
                        <div className="absolute -bottom-1 left-1/2 -translate-x-1/2 w-2 h-2 bg-dark-200/95 border-r border-b border-white/10 rotate-45" />
                    </div>
                </div>
            )}

            {/* Legend */}
            <div className="flex flex-wrap items-center justify-between sm:justify-end gap-3 mt-4">
                <div className="flex items-center gap-3">
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">Less</span>
                    <div className="flex gap-1">
                        <div className="w-[10px] h-[10px] rounded-[2px] bg-white/[0.03]" />
                        <div className="w-[10px] h-[10px] rounded-[2px] bg-purple-900/40" />
                        <div className="w-[10px] h-[10px] rounded-[2px] bg-purple-700/60" />
                        <div className="w-[10px] h-[10px] rounded-[2px] bg-purple-500/80" />
                        <div className="w-[10px] h-[10px] rounded-[2px] bg-accent shadow-[0_0_10px_rgba(139,92,246,0.3)]" />
                    </div>
                    <span className="text-[9px] font-black uppercase tracking-widest text-gray-500">More</span>
                </div>
            </div>
        </div>
    );
}
