import { useMemo } from 'react';
import { Flame } from 'lucide-react';

/**
 * ActivityHeatmap - GitHub-style contribution/watching activity graph
 * Shows user's anime watching activity over the past year
 */
export default function ActivityHeatmap({ activityData = [], username }) {
    // Generate the past 52 weeks of dates
    const weeks = useMemo(() => {
        const today = new Date();
        const result = [];

        // Create 52 weeks of data (364 days)
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

    // Calculate stats
    const stats = useMemo(() => {
        const totalActivity = activityData.reduce((sum, a) => sum + a.count, 0);
        const activeDays = activityData.filter(a => a.count > 0).length;

        // Calculate current streak
        let currentStreak = 0;
        const today = new Date().toISOString().split('T')[0];
        const sortedActivity = [...activityData].sort((a, b) =>
            new Date(b.date) - new Date(a.date)
        );

        for (const activity of sortedActivity) {
            const daysDiff = Math.floor(
                (new Date(today) - new Date(activity.date)) / (1000 * 60 * 60 * 24)
            );
            if (daysDiff <= currentStreak + 1 && activity.count > 0) {
                currentStreak++;
            } else {
                break;
            }
        }

        return { totalActivity, activeDays, currentStreak };
    }, [activityData]);

    // Get color intensity based on count
    const getColorClass = (count) => {
        if (count === 0) return 'bg-gray-800/50';
        if (count <= 2) return 'bg-purple-900/70';
        if (count <= 4) return 'bg-purple-700/80';
        if (count <= 6) return 'bg-purple-500';
        return 'bg-purple-400';
    };

    const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

    return (
        <div className="bg-dark-100 rounded-xl border border-gray-800 p-6">
            <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                    <Flame className="w-5 h-5 text-orange-500" />
                    Watching Activity
                </h3>
                {stats.totalActivity > 0 ? (
                    <div className="flex items-center gap-4 text-xs">
                        <div className="flex items-center gap-1.5">
                            <span className="text-gray-500">Total:</span>
                            <span className="text-white font-medium">{stats.totalActivity} episodes</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                            <Flame className="w-3.5 h-3.5 text-orange-400" />
                            <span className="text-orange-400 font-medium">{stats.currentStreak} day streak</span>
                        </div>
                    </div>
                ) : (
                    <span className="text-xs text-gray-500 bg-gray-800 px-2 py-1 rounded-full">Coming Soon</span>
                )}
            </div>

            {/* Month labels */}
            <div className="flex text-[10px] text-gray-500 mb-1 ml-8">
                {months.map((month, i) => (
                    <span key={month} className="flex-1 text-center" style={{ display: i % 2 === 0 ? 'block' : 'none' }}>
                        {month}
                    </span>
                ))}
            </div>

            {/* Heatmap grid */}
            <div className="flex gap-1">
                {/* Day labels */}
                <div className="flex flex-col gap-0.5 text-[9px] text-gray-500 pr-1">
                    {days.map((day, i) => (
                        <span key={day} className="h-[10px] leading-[10px]" style={{ visibility: i % 2 === 0 ? 'visible' : 'hidden' }}>
                            {day.slice(0, 2)}
                        </span>
                    ))}
                </div>

                {/* Cells */}
                <div className="flex gap-0.5 flex-1 overflow-x-auto scrollbar-hide">
                    {weeks.map((week, weekIndex) => (
                        <div key={weekIndex} className="flex flex-col gap-0.5">
                            {week.map((day, dayIndex) => (
                                <div
                                    key={day.date}
                                    className={`heatmap-cell ${getColorClass(day.count)} transition-all cursor-default`}
                                    title={`${day.displayDate}: ${day.count} episodes watched`}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </div>

            {/* Legend */}
            <div className="flex items-center justify-end gap-2 mt-3 text-[10px] text-gray-500">
                <span>Less</span>
                <div className="flex gap-0.5">
                    <div className="heatmap-cell bg-gray-800/50" />
                    <div className="heatmap-cell bg-purple-900/70" />
                    <div className="heatmap-cell bg-purple-700/80" />
                    <div className="heatmap-cell bg-purple-500" />
                    <div className="heatmap-cell bg-purple-400" />
                </div>
                <span>More</span>
            </div>
        </div>
    );
}
