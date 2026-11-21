import { formatCompactCount, getStatusDistributionTotal, normalizeStatusDistribution } from '../utils/statusDistribution';

const STATUSES = [
    { key: 'plan_to_watch', label: 'Plan', color: '#4ade80' },
    { key: 'watching', label: 'Watch', color: '#06b6d4' },
    { key: 'on_hold', label: 'Hold', color: '#a855f7' },
    { key: 'completed', label: 'Done', color: '#f472b6' },
    { key: 'dropped', label: 'Drop', color: '#f43f5e' },
];

/**
 * Members per list status. By default it shows AniList's counts
 * (`anime.status_distribution`, decision D-3) labelled "On AniList"; pass
 * `distribution` and `sourceLabel` for another source (AniShows' own
 * `site_status_distribution`).
 */
export default function StatusDistribution({
    anime,
    distribution: distributionOverride,
    sourceLabel = 'On AniList',
    className = "",
    title = 'Status Distribution',
    showTitle = true,
}) {
    const distribution = normalizeStatusDistribution(
        distributionOverride !== undefined ? distributionOverride : anime?.status_distribution
    );
    const totalMembers = getStatusDistributionTotal(distribution);

    return (
        <div className={`bg-dark-100/50 rounded-2xl px-4 py-5 sm:px-5 border border-gray-800 ${className}`}>
            {showTitle && (
                <div className="flex items-baseline justify-between gap-3 mb-4 sm:mb-6">
                    <h3 className="text-xs font-bold text-gray-500 uppercase tracking-[0.16em]">
                        {title}
                    </h3>
                    {sourceLabel ? (
                        <span className="text-[10px] font-bold uppercase tracking-wide text-gray-600">
                            {sourceLabel}
                        </span>
                    ) : null}
                </div>
            )}
            <div className="flex justify-between gap-1 mb-4">
                {STATUSES.map(({ key, label, color }) => {
                    const count = distribution[key];
                    const isActive = count > 0;
                    return (
                        <div key={key} className="flex flex-col items-center text-center">
                            <span className={`whitespace-nowrap font-bold leading-none tabular tracking-tight ${isActive ? 'text-gray-200 text-[13px]' : 'text-gray-600 text-[13px]'}`}>
                                {formatCompactCount(count)}
                            </span>
                            <span 
                                className="text-[10px] font-bold uppercase tracking-wide mt-1.5"
                                style={{ color: isActive ? color : '#374151' }}
                            >
                                {label}
                            </span>
                        </div>
                    );
                })}
            </div>

            <div className="relative h-1.5 w-full bg-gray-800 rounded-full overflow-hidden">
                <div className="absolute inset-0 flex items-center gap-[1px]">
                    {totalMembers > 0 ? (
                        STATUSES.map(({ key, color }) => {
                            const count = distribution[key];
                            const width = (count / totalMembers) * 100;
                            if (width === 0) return null;
                            return (
                                <div
                                    key={key}
                                    className="h-full first:rounded-l-full last:rounded-r-full"
                                    style={{
                                        width: `${width}%`,
                                        backgroundColor: color,
                                        borderRadius: totalMembers === count ? '999px' : undefined
                                    }}
                                />
                            );
                        })
                    ) : (
                        <div className="h-full w-full bg-gray-700 rounded-full" />
                    )}
                </div>
            </div>
        </div>
    );
}
