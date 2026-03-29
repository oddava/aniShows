
import { Star, BarChart3, Book, Film, Music, Users, EyeOff, Eye } from 'lucide-react';

// Rating distribution bar
const RatingBar = ({ stars, count, total, onFilter, isActive, accentColor }) => {
    const percentage = total > 0 ? (count / total) * 100 : 0;

    return (
        <button
            onClick={() => onFilter(stars)}
            className={`flex items-center gap-3 w-full group py-1 transition-all ${isActive ? 'opacity-100' : 'opacity-70 hover:opacity-100'}`}
        >
            <div className="flex items-center gap-1 w-12 shrink-0">
                <span className="text-sm font-medium text-gray-400">{stars}</span>
                <Star className="w-3.5 h-3.5 text-yellow-500 fill-yellow-500" />
            </div>
            <div className="flex-1 h-2.5 bg-gray-800 rounded-full overflow-hidden">
                <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                        width: `${percentage}%`,
                        backgroundColor: isActive ? (accentColor || '#75698d') : 'rgba(234, 179, 8, 0.7)'
                    }}
                />
            </div>
            <span className="text-xs text-gray-500 w-8 text-right font-medium">{count}</span>
        </button>
    );
};

// Average sub-score display
const AvgSubScore = ({ icon: Icon, label, value }) => {  // eslint-disable-line no-unused-vars
    if (!value && value !== 0) return null;
    const displayValue = value.toFixed(1);

    return (
        <div className="flex flex-col items-center gap-1 p-3 bg-dark-200/50 rounded-xl border border-gray-800/50">
            <Icon className="w-4 h-4 text-gray-500" />
            <span className="text-lg font-bold text-white">{displayValue}</span>
            <span className="text-[10px] text-gray-500 uppercase tracking-wider">{label}</span>
        </div>
    );
};

export default function ReviewSummary({
    stats,
    onFilterByRating,
    activeRatingFilter,
    hideSpoilers,
    onToggleHideSpoilers,
    accentColor = null
}) {
    if (!stats) return null;

    const { distribution, averages, total_reviews } = stats;

    // Calculate overall average from distribution
    const overallAvg = averages?.overall || 0;

    return (
        <div className="bg-dark-100/50 rounded-2xl border border-gray-800 p-6 mb-8">
            <div className="flex items-center justify-between mb-5">
                <h3 className="text-sm font-bold text-gray-400 uppercase tracking-wider flex items-center gap-2">
                    <BarChart3 className="w-4 h-4" />
                    Review Summary
                </h3>

                {/* Spoiler Toggle */}
                <button
                    onClick={onToggleHideSpoilers}
                    className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${hideSpoilers
                        ? 'bg-red-500/10 text-red-400 border border-red-500/20'
                        : 'bg-gray-800 text-gray-400 border border-gray-700 hover:text-white'
                        }`}
                >
                    {hideSpoilers ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                    {hideSpoilers ? 'Spoilers Hidden' : 'Hide Spoilers'}
                </button>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8">
                {/* Rating Distribution */}
                <div>
                    <div className="flex items-baseline gap-3 mb-4">
                        <span className="text-4xl font-black text-white">{overallAvg.toFixed(1)}</span>
                        <div className="flex items-center gap-1">
                            {[1, 2, 3, 4, 5].map((i) => (
                                <Star
                                    key={i}
                                    className={`w-4 h-4 ${i <= Math.round(overallAvg) ? 'text-yellow-500 fill-yellow-500' : 'text-gray-700'}`}
                                />
                            ))}
                        </div>
                        <span className="text-sm text-gray-500">{total_reviews} reviews</span>
                    </div>

                    <div className="space-y-1.5">
                        {[5, 4, 3, 2, 1].map((stars) => (
                            <RatingBar
                                key={stars}
                                stars={stars}
                                count={distribution?.[stars] || 0}
                                total={total_reviews}
                                onFilter={onFilterByRating}
                                isActive={activeRatingFilter === stars}
                                accentColor={accentColor}
                            />
                        ))}
                    </div>

                    {activeRatingFilter && (
                        <button
                            onClick={() => onFilterByRating(null)}
                            className="mt-3 text-xs hover:underline"
                            style={{ color: accentColor || '#75698d' }}
                        >
                            Clear filter
                        </button>
                    )}
                </div>

                {/* Average Sub-Scores */}
                <div>
                    <p className="text-xs text-gray-500 uppercase tracking-wider mb-3">Category Averages</p>
                    <div className="grid grid-cols-4 gap-2">
                        <AvgSubScore icon={Book} label="Story" value={averages?.story} />
                        <AvgSubScore icon={Film} label="Animation" value={averages?.animation} />
                        <AvgSubScore icon={Music} label="Music" value={averages?.music} />
                        <AvgSubScore icon={Users} label="Characters" value={averages?.characters} />
                    </div>
                </div>
            </div>
        </div>
    );
}
