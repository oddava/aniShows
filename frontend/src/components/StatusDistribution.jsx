import { formatCompactCount, getStatusDistributionTotal, normalizeStatusDistribution } from '../utils/statusDistribution';
import { statusMeta } from '../utils/listStatus';

// Distribution keys mapped to the list statuses' own labels and colours.
const STATUSES = [
    { key: 'watching', status: 'Watching' },
    { key: 'completed', status: 'Completed' },
    { key: 'plan_to_watch', status: 'Plan to Watch' },
    { key: 'on_hold', status: 'On Hold' },
    { key: 'dropped', status: 'Dropped' },
].map(({ key, status }) => {
    const meta = statusMeta(status);
    return { key, label: meta?.label || status, color: meta?.color || 'var(--text-3)' };
});

/**
 * Members per list status. By default it shows AniList's counts
 * (`anime.status_distribution`, decision D-3) labelled "On AniList"; pass
 * `distribution` and `sourceLabel` for another source (AniShows' own
 * `site_status_distribution`). Renders nothing when every count is zero.
 */
export default function StatusDistribution({
    anime,
    distribution: distributionOverride,
    sourceLabel = 'On AniList',
    className = '',
    title = 'Status distribution',
    showTitle = true,
}) {
    const distribution = normalizeStatusDistribution(
        distributionOverride !== undefined ? distributionOverride : anime?.status_distribution
    );
    const totalMembers = getStatusDistributionTotal(distribution);

    if (totalMembers <= 0) return null;

    return (
        <section className={`min-w-0 ${className}`}>
            {showTitle && (
                <div className="mb-4 flex items-baseline justify-between gap-3">
                    <h2 className="section-title">{title}</h2>
                    {sourceLabel ? <span className="text-sm text-[var(--text-3)]">{sourceLabel}</span> : null}
                </div>
            )}

            <div className="flex h-2 w-full gap-[2px] overflow-hidden rounded-full bg-[var(--ink-3)]" aria-hidden="true">
                {STATUSES.map(({ key, color }) => {
                    const count = distribution[key];
                    if (!count) return null;
                    return (
                        <div
                            key={key}
                            className="h-full"
                            style={{ width: `${(count / totalMembers) * 100}%`, backgroundColor: color }}
                        />
                    );
                })}
            </div>

            <dl className="mt-4">
                {STATUSES.map(({ key, label, color }) => (
                    <div key={key} className="flex items-center justify-between gap-3 py-1.5">
                        <dt className="flex items-center gap-2.5 text-[15px] text-[var(--text-2)]">
                            <span aria-hidden="true" className="h-2 w-2 rounded-full" style={{ backgroundColor: color }} />
                            {label}
                        </dt>
                        <dd className="tabular text-[15px] text-[var(--text-1)]">{formatCompactCount(distribution[key])}</dd>
                    </div>
                ))}
            </dl>
        </section>
    );
}
