// Rating distribution bar: a row you can click to filter by that score.
const RatingBar = ({ stars, count, total, onFilter, isActive }) => {
    const percentage = total > 0 ? (count / total) * 100 : 0;

    return (
        <button
            type="button"
            onClick={() => onFilter(stars)}
            aria-pressed={isActive}
            aria-label={`${stars} stars: ${count} reviews`}
            className="group flex min-h-8 w-full items-center gap-3"
        >
            <span className={`w-4 shrink-0 text-sm tabular ${isActive ? 'text-[var(--signature)]' : 'text-[var(--text-2)]'}`}>{stars}</span>
            <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-[var(--ink-3)]">
                <span
                    className={`block h-full rounded-full transition-[width] duration-500 ${isActive ? 'bg-[var(--signature)]' : 'bg-[var(--text-3)] group-hover:bg-[var(--text-2)]'}`}
                    style={{ width: `${percentage}%` }}
                />
            </span>
            <span className="w-8 text-right text-sm text-[var(--text-3)] tabular">{count}</span>
        </button>
    );
};

// Average sub-score: a number over its label, no box.
const AvgSubScore = ({ label, value }) => {
    if (!value && value !== 0) return null;

    return (
        <div>
            <p className="text-[1.25rem] font-semibold text-[var(--text-1)] tabular">{value.toFixed(1)}</p>
            <p className="text-sm text-[var(--text-2)]">{label}</p>
        </div>
    );
};

export default function ReviewSummary({
    stats,
    onFilterByRating,
    activeRatingFilter,
    hideSpoilers,
    onToggleHideSpoilers,
}) {
    if (!stats) return null;

    const { distribution, averages, total_reviews } = stats;
    const overallAvg = averages?.overall || 0;
    const hasCategories = ['story', 'animation', 'music', 'characters'].some((key) => averages?.[key] != null);

    return (
        <div className="mb-10">
            <div className="grid grid-cols-1 gap-10 lg:grid-cols-2">
                <div>
                    <p className="mb-4 flex items-baseline gap-3">
                        <span className="text-[2.5rem] font-semibold leading-none tracking-[-0.03em] text-[var(--text-1)] tabular">{overallAvg.toFixed(1)}</span>
                        <span className="text-[15px] text-[var(--text-2)]">/ 5 from {total_reviews} {total_reviews === 1 ? 'review' : 'reviews'}</span>
                    </p>

                    <div>
                        {[5, 4, 3, 2, 1].map((stars) => (
                            <RatingBar
                                key={stars}
                                stars={stars}
                                count={distribution?.[stars] || 0}
                                total={total_reviews}
                                onFilter={onFilterByRating}
                                isActive={activeRatingFilter === stars}
                            />
                        ))}
                    </div>

                    {activeRatingFilter && (
                        <button type="button" onClick={() => onFilterByRating(null)} className="text-link mt-3 text-sm">
                            Clear filter
                        </button>
                    )}
                </div>

                <div className="flex flex-col gap-6">
                    {hasCategories && (
                        <div>
                            <p className="mb-3 text-sm text-[var(--text-2)]">Category averages</p>
                            <div className="grid grid-cols-4 gap-4">
                                <AvgSubScore label="Story" value={averages?.story} />
                                <AvgSubScore label="Animation" value={averages?.animation} />
                                <AvgSubScore label="Music" value={averages?.music} />
                                <AvgSubScore label="Characters" value={averages?.characters} />
                            </div>
                        </div>
                    )}
                    <label className="inline-flex min-h-11 cursor-pointer items-center gap-2.5 self-start text-[15px] text-[var(--text-2)]">
                        <input
                            type="checkbox"
                            checked={Boolean(hideSpoilers)}
                            onChange={onToggleHideSpoilers}
                            className="h-4 w-4 accent-[var(--signature)]"
                        />
                        Hide spoilers
                    </label>
                </div>
            </div>
        </div>
    );
}
